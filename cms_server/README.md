# CMS Mock Server

This is a mock implementation of the **Customer Management System (CMS)** for the Swift Logistics project.  
It simulates a SOAP/XML web service that exposes a minimal set of customer-related operations, allowing developers to integrate and test against a predictable backend without relying on the real CMS.

---

## How to get up and running CMS server

Come inside this directory.

run

```
npm install
node index.js
```

## 📌 Features

- SOAP/XML API endpoints for customer management.
- Example WSDL contract included.
- Lightweight mock responses (static or rule-based).
- Docker-ready for containerized development.

## ⚙️ Endpoints (SOAP Actions)

The mock server exposes the following SOAP operations:

1. CreateOrder
2. GetOrderStatus

---

### inside this directory run this to test

```
curl -v -X POST http://localhost:3006/soap   -H "Content-Type: text/xml"   -H 'SOAPAction: "CreateOrder"'   --data-binary @createOrder.xml
```

```
curl -X POST -H "Content-Type: text/xml" --data-binary @getStatus.xml http://localhost:3006/soap
```
