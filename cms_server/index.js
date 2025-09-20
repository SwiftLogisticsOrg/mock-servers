import express from 'express';
import { parseStringPromise, Builder, processors } from 'xml2js';
import { v4 as uuidv4 } from 'uuid';
import morgan from 'morgan';

const stripPrefix = processors.stripPrefix;
const app = express();
app.use(morgan('dev'));

// Accept raw XML for all content-types (SOAP clients often send text/xml)
app.use(express.text({ type: '*/*', limit: '1mb' }));

const PORT = process.env.PORT || 3006;

// In-memory storage for cms orders
const cmsOrders = {}; // cmsOrders[cmsId] = { status, clientOrderRef, createdAt, payload, billingRef }

// Helpers
function makeCmsId() {
  return 'CMS-' + uuidv4().split('-')[0].toUpperCase();
}

function buildSoapEnvelope(bodyObj) {
  const builder = new Builder({ headless: true, renderOpts: { pretty: true } });
  // bodyObj expected to be { 'soap:Body': { ... } }
  const envelope = {
    'soap:Envelope': {
      '$': { 'xmlns:soap': 'http://schemas.xmlsoap.org/soap/envelope/' },
      ...bodyObj
    }
  };
  return builder.buildObject(envelope);
}

function soapFault(faultString) {
  const body = { 'soap:Body': { 'soap:Fault': { faultcode: 'soap:Client', faultstring: faultString } } };
  return buildSoapEnvelope(body);
}

// Main SOAP endpoint
app.post('/soap', async (req, res) => {
  const rawXml = req.body || '';
  if (!rawXml) {
    return res.status(400).type('text/xml').send(soapFault('Empty request body'));
  }

  try {
    // Parse XML and strip namespace prefixes to make keys simple
    const parsed = await parseStringPromise(rawXml, { explicitArray: false, tagNameProcessors: [stripPrefix] });

    // Typical structure: parsed.Envelope.Body.<ActionRequest>
    const envelope = parsed.Envelope || parsed['soap:Envelope'] || parsed;
    const body = envelope.Body || envelope['soap:Body'];
    if (!body) {
      return res.status(400).type('text/xml').send(soapFault('Invalid SOAP: Body not found'));
    }

    const actionKey = Object.keys(body)[0]; // e.g., CreateOrderRequest
    if (!actionKey) {
      return res.status(400).type('text/xml').send(soapFault('No SOAP action found'));
    }

    const action = actionKey.replace(/^.*:/, ''); // safe strip
    const payload = body[actionKey];

    // Debug log
    console.log('SOAP action:', action);
    // Handle actions
    if (/CreateOrder/i.test(action)) {
      // Extract fields (use safe access)
      const clientId = payload.ClientId || payload.clientId || 'unknown';
      const clientOrderRef = payload.ClientOrderRef || payload.clientOrderRef || payload.ClientRef || 'local-' + Date.now();
      const pickup = payload.PickupAddress || payload.pickup;
      const delivery = payload.DeliveryAddress || payload.delivery;
      const items = payload.Items || payload.items || {};
      const contact = payload.Contact || payload.contact || '';

      // Optional: support a query param to cause failure for testing
      if (req.query.fail === 'true') {
        const faultXml = soapFault('Simulated CMS failure');
        return res.status(500).type('text/xml').send(faultXml);
      }

      // Create CmsOrderId & store
      const cmsOrderId = makeCmsId();
      const billingRef = 'INV-' + Date.now();

      cmsOrders[cmsOrderId] = {
        cmsOrderId,
        clientId,
        clientOrderRef,
        pickup,
        delivery,
        items,
        contact,
        billingRef,
        status: 'Received',
        createdAt: new Date().toISOString()
      };

      // Simulate asynchronous processing: Received -> Processing -> Confirmed
      setTimeout(() => {
        if (cmsOrders[cmsOrderId]) cmsOrders[cmsOrderId].status = 'Processing';
      }, 2000);
      setTimeout(() => {
        if (cmsOrders[cmsOrderId]) cmsOrders[cmsOrderId].status = 'Confirmed';
      }, 6000);

      // Build SOAP response
      const respBody = {
        'soap:Body': {
          CreateOrderResponse: {
            '$': { 'xmlns': 'http://swiftlogistics.cms/' },
            Success: 'true',
            CmsOrderId: cmsOrderId,
            BillingRef: billingRef,
            Message: 'Order accepted'
          }
        }
      };
      const xmlResponse = buildSoapEnvelope(respBody);
      res.type('text/xml').send(xmlResponse);
      return;
    }

    if (/GetOrderStatus/i.test(action)) {
      const cmsOrderId = payload.CmsOrderId || payload.cmsOrderId || payload.CmsId;
      if (!cmsOrderId || !cmsOrders[cmsOrderId]) {
        const resp = {
          'soap:Body': {
            GetOrderStatusResponse: {
              '$': { xmlns: 'http://swiftlogistics.cms/' },
              CmsOrderId: cmsOrderId || '',
              Status: 'NotFound',
              Message: 'Order not found'
            }
          }
        };
        return res.type('text/xml').status(200).send(buildSoapEnvelope(resp));
      }
      const ord = cmsOrders[cmsOrderId];
      const resp = {
        'soap:Body': {
          GetOrderStatusResponse: {
            '$': { xmlns: 'http://swiftlogistics.cms/' },
            CmsOrderId: cmsOrderId,
            Status: ord.status,
            Message: 'OK'
          }
        }
      };
      return res.type('text/xml').send(buildSoapEnvelope(resp));
    }

    if (/GetClient/i.test(action)) {
      // Minimal stub: return client info based on ClientId
      const clientId = payload.ClientId || payload.clientId;
      const resp = {
        'soap:Body': {
          GetClientResponse: {
            '$': { xmlns: 'http://swiftlogistics.cms/' },
            ClientId: clientId || '',
            Name: 'Demo Client',
            AccountStatus: 'Active'
          }
        }
      };
      return res.type('text/xml').send(buildSoapEnvelope(resp));
    }

    // Unknown action -> SOAP fault
    return res.status(400).type('text/xml').send(soapFault(`Unknown action "${action}"`));
  } catch (err) {
    console.error('Error parsing SOAP:', err);
    return res.status(500).type('text/xml').send(soapFault('Server error parsing SOAP'));
  }
});


// --- Admin / debug endpoints ---
app.get('/admin/orders', (req, res) => {
  res.json(Object.values(cmsOrders));
});

// Force a status or simulate failure for an order
app.post('/admin/orders/:cmsId/fail', express.json(), (req, res) => {
  const cmsId = req.params.cmsId;
  if (!cmsOrders[cmsId]) return res.status(404).json({ error: 'not found' });
  cmsOrders[cmsId].status = 'Error';
  return res.json({ ok: true, cmsId, newStatus: cmsOrders[cmsId].status });
});

app.listen(PORT, () => {
  console.log(`Mock CMS SOAP server listening on http://localhost:${PORT}/soap`);
  console.log(`Admin endpoints: GET /admin/orders  POST /admin/orders/:cmsId/fail`);
});
