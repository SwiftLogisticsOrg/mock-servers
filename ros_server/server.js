require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(morgan('dev'));
app.use(express.json());

// In-memory data stores
const drivers = new Map([
  ['driver-001', {
    id: 'driver-001',
    name: 'John Smith',
    status: 'available',
    currentLocation: { latitude: 40.7128, longitude: -74.0060 }, // NYC
    vehicle: 'van-001',
    maxCapacity: 100,
    skills: ['fragile', 'heavy']
  }],
  ['driver-002', {
    id: 'driver-002',
    name: 'Sarah Johnson',
    status: 'available',
    currentLocation: { latitude: 40.7589, longitude: -73.9851 }, // Times Square
    vehicle: 'truck-001',
    maxCapacity: 200,
    skills: ['bulk', 'refrigerated']
  }],
  ['driver-003', {
    id: 'driver-003',
    name: 'Mike Wilson',
    status: 'available',
    currentLocation: { latitude: 40.7282, longitude: -73.7949 }, // Queens
    vehicle: 'van-002',
    maxCapacity: 80,
    skills: ['express', 'documents']
  }],
  ['driver-004', {
    id: 'driver-004',
    name: 'Emma Davis',
    status: 'on-trip',
    currentLocation: { latitude: 40.6892, longitude: -74.0445 }, // Brooklyn
    vehicle: 'motorcycle-001',
    maxCapacity: 20,
    skills: ['express', 'small-packages']
  }]
]);

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

function findNearestAvailableDriver(pickupLocation) {
  let nearestDriver = null;
  let minDistance = Infinity;

  for (const [driverId, driver] of drivers) {
    if (driver.status === 'available') {
      const distance = calculateDistance(driver.currentLocation, pickupLocation);
      if (distance < minDistance) {
        minDistance = distance;
        nearestDriver = { ...driver, distanceToPickup: distance };
      }
    }
  }

  return nearestDriver;
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
      'POST /api/ros/optimize',
      'POST /api/ros/assign-driver',
      'POST /api/ros/drivers/:driverId/location',
      'GET /api/ros/drivers/:driverId/location',
      'GET /api/ros/drivers'
    ]
  });
});

// Route optimization endpoint
app.post('/api/ros/optimize', async (req, res) => {
  try {
    await simulateProcessingDelay();

    const { stops = [], vehicles = [] } = req.body;

    if (!stops.length || !vehicles.length) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: stops and vehicles arrays'
      });
    }

    // Simple mock optimization: create sequential routes
    const routes = vehicles.map((vehicle, index) => {
      const vehicleStops = stops.filter((_, i) => i % vehicles.length === index);

      let currentLocation = vehicle.startLocation || { latitude: 40.7128, longitude: -74.0060 };
      let totalDistance = 0;
      let totalDuration = 0;

      const steps = vehicleStops.map((stop, stepIndex) => {
        const distance = calculateDistance(currentLocation, stop.coordinates || stop.location || currentLocation);
        const duration = calculateETA(distance);

        totalDistance += distance;
        totalDuration += duration;

        const now = new Date();
        const arrival = new Date(now.getTime() + totalDuration * 1000);
        const departure = new Date(arrival.getTime() + (stop.serviceTime || 300) * 1000);

        currentLocation = stop.coordinates || stop.location || currentLocation;

        return {
          id: stop.id || `stop-${stepIndex}`,
          address: stop.address || `Stop ${stepIndex + 1}`,
          type: stop.type || (stepIndex === 0 ? 'pickup' : 'delivery'),
          arrival: arrival.toISOString(),
          departure: departure.toISOString(),
          location: {
            address: stop.address || `Stop ${stepIndex + 1}`,
            coordinates: currentLocation
          },
          distance: Math.round(distance * 100) / 100,
          duration: duration,
          description: `${stop.type || 'Stop'} at ${stop.address || 'location'}`
        };
      });

      return {
        vehicleId: vehicle.id || `vehicle-${index + 1}`,
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
      success: true,
      data: {
        optimized: true,
        totalDistance: Math.round(totalDistance * 100) / 100,
        totalDuration: totalDuration,
        totalCost: Math.round(totalCost * 100) / 100,
        routes,
        unassigned: [],
        metadata: {
          optimizationTime: Date.now(),
          provider: 'ros-mock-server',
          algorithm: 'simple-sequential',
          timestamp: new Date().toISOString()
        }
      }
    };

    console.log(`[ROS] Route optimization completed for ${vehicles.length} vehicles, ${stops.length} stops`);
    res.json(response);

  } catch (error) {
    console.error('[ROS] Route optimization error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during route optimization'
    });
  }
});

// Driver assignment endpoint
app.post('/api/ros/assign-driver', async (req, res) => {
  try {
    await simulateProcessingDelay();

    const { orderId, pickupLocation, deliveryLocation } = req.body;

    if (!orderId || !pickupLocation) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: orderId and pickupLocation'
      });
    }

    // Find the best available driver
    const assignedDriver = findNearestAvailableDriver(pickupLocation);

    if (!assignedDriver) {
      return res.status(404).json({
        success: false,
        error: 'No available drivers found'
      });
    }

    // Update driver status
    const driver = drivers.get(assignedDriver.id);
    driver.status = 'on-trip';
    driver.currentOrder = orderId;

    const etaToPickup = calculateETA(assignedDriver.distanceToPickup);

    console.log(`[ROS] Driver ${assignedDriver.name} assigned to order ${orderId}`);

    res.json({
      success: true,
      data: {
        driverId: assignedDriver.id,
        name: assignedDriver.name,
        vehicle: assignedDriver.vehicle,
        currentLocation: assignedDriver.currentLocation,
        distanceToPickup: Math.round(assignedDriver.distanceToPickup * 100) / 100,
        etaToPickup: etaToPickup,
        estimatedArrival: new Date(Date.now() + etaToPickup * 1000).toISOString(),
        contact: `+1-555-${Math.floor(Math.random() * 9000) + 1000}`,
        metadata: {
          assignedAt: new Date().toISOString(),
          orderId
        }
      }
    });

  } catch (error) {
    console.error('[ROS] Driver assignment error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during driver assignment'
    });
  }
});

// Update driver location endpoint
app.post('/api/ros/drivers/:driverId/location', (req, res) => {
  try {
    const { driverId } = req.params;
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: latitude and longitude'
      });
    }

    const driver = drivers.get(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        error: 'Driver not found'
      });
    }

    // Update driver location
    driver.currentLocation = { latitude, longitude };
    driver.lastLocationUpdate = new Date().toISOString();

    console.log(`[ROS] Location updated for driver ${driver.name}: ${latitude}, ${longitude}`);

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: {
        driverId,
        location: driver.currentLocation,
        timestamp: driver.lastLocationUpdate
      }
    });

  } catch (error) {
    console.error('[ROS] Location update error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during location update'
    });
  }
});

// Get driver location endpoint
app.get('/api/ros/drivers/:driverId/location', (req, res) => {
  try {
    const { driverId } = req.params;
    const driver = drivers.get(driverId);

    if (!driver) {
      return res.status(404).json({
        success: false,
        error: 'Driver not found'
      });
    }

    res.json({
      success: true,
      data: {
        driverId,
        name: driver.name,
        currentLocation: driver.currentLocation,
        status: driver.status,
        lastLocationUpdate: driver.lastLocationUpdate || new Date().toISOString(),
        vehicle: driver.vehicle
      }
    });

  } catch (error) {
    console.error('[ROS] Get location error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while retrieving location'
    });
  }
});

// Get all drivers endpoint (for admin/debugging)
app.get('/api/ros/drivers', (req, res) => {
  try {
    const driversArray = Array.from(drivers.values()).map(driver => ({
      id: driver.id,
      name: driver.name,
      status: driver.status,
      currentLocation: driver.currentLocation,
      vehicle: driver.vehicle,
      maxCapacity: driver.maxCapacity,
      skills: driver.skills,
      currentOrder: driver.currentOrder || null,
      lastLocationUpdate: driver.lastLocationUpdate || null
    }));

    res.json({
      success: true,
      data: {
        drivers: driversArray,
        total: driversArray.length,
        available: driversArray.filter(d => d.status === 'available').length,
        onTrip: driversArray.filter(d => d.status === 'on-trip').length
      }
    });

  } catch (error) {
    console.error('[ROS] Get drivers error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while retrieving drivers'
    });
  }
});

// Reset driver status endpoint (for testing)
app.post('/api/ros/drivers/:driverId/reset', (req, res) => {
  try {
    const { driverId } = req.params;
    const driver = drivers.get(driverId);

    if (!driver) {
      return res.status(404).json({
        success: false,
        error: 'Driver not found'
      });
    }

    driver.status = 'available';
    delete driver.currentOrder;

    console.log(`[ROS] Driver ${driver.name} status reset to available`);

    res.json({
      success: true,
      message: 'Driver status reset to available',
      data: {
        driverId,
        name: driver.name,
        status: driver.status
      }
    });

  } catch (error) {
    console.error('[ROS] Reset driver error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during driver reset'
    });
  }
});

// Error handling middleware
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'POST /api/ros/optimize',
      'POST /api/ros/assign-driver',
      'POST /api/ros/drivers/:driverId/location',
      'GET /api/ros/drivers/:driverId/location',
      'GET /api/ros/drivers',
      'POST /api/ros/drivers/:driverId/reset'
    ]
  });
});

app.use((error, req, res, next) => {
  console.error('[ROS] Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[ROS MOCK SERVER] Running on http://localhost:${PORT}`);
  console.log(`[ROS MOCK SERVER] Health check: GET /health`);
  console.log(`[ROS MOCK SERVER] Available drivers: ${drivers.size}`);
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