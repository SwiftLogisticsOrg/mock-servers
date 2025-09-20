require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(morgan('dev'));
app.use(express.json());

// In-memory data stores (removed driver data as adapter handles this)

// Helper functions
function generateId() {
  return uuidv4().split('-')[0].toUpperCase();
}

function calculateDistance(point1, point2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(point2.latitude - point1.latitude);
  const dLon = toRad(point2.longitude - point1.longitude);
  const lat1 = toRad(point1.latitude);
  const lat2 = toRad(point2.latitude);

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

function toRad(degrees) {
  return degrees * (Math.PI/180);
}

function simulateProcessingDelay() {
  return new Promise(resolve => {
    const delay = Math.floor(Math.random() * 600) + 200; // 200-800ms
    setTimeout(resolve, delay);
  });
}

function calculateETA(distance) {
  // Estimate: 30 km/h average speed in city, converted to seconds
  return Math.round(distance * 120); // seconds
}

// Add ETA calculation endpoint for adapter compatibility
app.post('/api/ros/eta', async (req, res) => {
  try {
    await simulateProcessingDelay();

    const { origin, destination, options = {} } = req.body;

    if (!origin?.coordinates || !destination?.coordinates) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: origin and destination coordinates'
      });
    }

    const distance = calculateDistance(
      { latitude: origin.coordinates.lat, longitude: origin.coordinates.lng },
      { latitude: destination.coordinates.lat, longitude: destination.coordinates.lng }
    );

    const duration = calculateETA(distance);
    const cost = Math.round(distance * 2.5 * 100) / 100; // $2.50 per km

    const response = {
      status: 'success',
      distance: Math.round(distance * 100) / 100,
      duration: duration,
      cost: cost,
      route_geometry: null, // Mock geometry
      traffic_considered: options.traffic || false,
      vehicle_type: options.vehicle_type || 'car',
      departure_time: options.departure_time || new Date().toISOString(),
      timestamp: new Date().toISOString()
    };

    console.log(`[ROS] ETA calculated: ${distance}km, ${duration}s`);
    res.json(response);

  } catch (error) {
    console.error('[ROS] ETA calculation error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error during ETA calculation'
    });
  }
});

// API Endpoints

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'ros-mock-server',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    endpoints: [
      'GET /health',
      'POST /optimize',
      'POST /api/ros/eta'
    ]
  });
});

// Route optimization endpoint - updated to match adapter expectations
app.post('/optimize', async (req, res) => {
  try {
    await simulateProcessingDelay();

    const { 
      optimization_profile = 'balanced',
      locations = [], 
      vehicles = [],
      options = {}
    } = req.body;

    if (!locations.length || !vehicles.length) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: locations and vehicles arrays'
      });
    }

    // Validate that all locations have coordinates
    for (let i = 0; i < locations.length; i++) {
      if (!locations[i].coordinates?.lat || !locations[i].coordinates?.lng) {
        return res.status(400).json({
          status: 'error',
          message: `Location ${locations[i].id || i} missing coordinates (lat/lng)`
        });
      }
    }

    // Validate that all vehicles have start_location
    for (let i = 0; i < vehicles.length; i++) {
      if (!vehicles[i].start_location?.lat || !vehicles[i].start_location?.lng) {
        return res.status(400).json({
          status: 'error',
          message: `Vehicle ${vehicles[i].id || i} missing start_location (lat/lng)`
        });
      }
    }

    // Simple mock optimization: create sequential routes
    const routes = vehicles.map((vehicle, index) => {
      const vehicleStops = locations.filter((_, i) => i % vehicles.length === index);

      if (!vehicle.start_location) {
        throw new Error(`Vehicle ${vehicle.id || index} missing start_location`);
      }

      let currentLocation = vehicle.start_location;
      let totalDistance = 0;
      let totalDuration = 0;

      const steps = vehicleStops.map((stop, stepIndex) => {
        if (!stop.coordinates) {
          throw new Error(`Stop ${stop.id || stepIndex} missing coordinates`);
        }

        const stopCoords = { 
          latitude: stop.coordinates.lat, 
          longitude: stop.coordinates.lng 
        };
        
        const currentCoords = { 
          latitude: currentLocation.lat || currentLocation.latitude, 
          longitude: currentLocation.lng || currentLocation.longitude 
        };

        const distance = calculateDistance(currentCoords, stopCoords);
        const duration = calculateETA(distance);

        totalDistance += distance;
        totalDuration += duration;

        const now = new Date();
        const arrival = new Date(now.getTime() + totalDuration * 1000);
        const departure = new Date(arrival.getTime() + (stop.service_time || 300) * 1000);

        currentLocation = { lat: stopCoords.latitude, lng: stopCoords.longitude };

        return {
          id: stop.id || `stop-${stepIndex}`,
          type: stop.type || (stepIndex === 0 ? 'pickup' : 'delivery'),
          location: {
            address: stop.address || `Stop ${stepIndex + 1}`,
            coordinates: {
              lat: stopCoords.latitude,
              lng: stopCoords.longitude
            }
          },
          arrival: arrival.toISOString(),
          departure: departure.toISOString(),
          distance: Math.round(distance * 100) / 100,
          duration: duration,
          description: `${stop.type || 'Stop'} at ${stop.address || 'location'}`
        };
      });

      return {
        vehicle_id: vehicle.id || `vehicle-${index + 1}`,
        distance: Math.round(totalDistance * 100) / 100,
        duration: totalDuration,
        cost: Math.round(totalDistance * 2.5 * 100) / 100, // $2.50 per km
        steps
      };
    });

    const totalDistance = routes.reduce((sum, route) => sum + route.distance, 0);
    const totalDuration = routes.reduce((sum, route) => sum + route.duration, 0);
    const totalCost = routes.reduce((sum, route) => sum + route.cost, 0);

    const response = {
      status: 'success',
      summary: {
        total_distance: Math.round(totalDistance * 100) / 100,
        total_time: totalDuration,
        total_cost: Math.round(totalCost * 100) / 100
      },
      routes,
      unassigned: [],
      optimization_time: Date.now(),
      timestamp: new Date().toISOString()
    };

    console.log(`[ROS] Route optimization completed for ${vehicles.length} vehicles, ${locations.length} locations`);
    res.json(response);

  } catch (error) {
    console.error('[ROS] Route optimization error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error during route optimization'
    });
  }
});

// Error handling middleware
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'POST /optimize',
      'POST /api/ros/eta'
    ]
  });
});

app.use((error, req, res, next) => {
  console.error('[ROS] Unhandled error:', error);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[ROS MOCK SERVER] Running on http://localhost:${PORT}`);
  console.log(`[ROS MOCK SERVER] Health check: GET /health`);
  console.log(`[ROS MOCK SERVER] Route optimization: POST /optimize`);
  console.log(`[ROS MOCK SERVER] ETA calculation: POST /api/ros/eta`);
  console.log(`[ROS MOCK SERVER] Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[ROS MOCK SERVER] SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[ROS MOCK SERVER] SIGINT received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;