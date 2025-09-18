# ROS Mock Server  README

A lightweight **Route Optimization System (ROS) mock server** that simulates route optimization, driver assignment, and location tracking APIs for the SwiftTrack logistics platform. This server provides RESTful endpoints that mimic real-world ROS behavior for development and testing purposes.

---

## Table of Contents

- [What this mock is for](#what-this-mock-is-for)
- [What it exposes](#what-it-exposes)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Data Models](#data-models)
- [Quick Start](#quick-start)
- [Testing Examples](#testing-examples)
- [Docker Support](#docker-support)
- [Troubleshooting](#troubleshooting)
- [Integration Notes](#integration-notes)

---

## What this mock is for

The ROS mock server simulates a third-party Route Optimization System to enable:

- **Route optimization**: Accept delivery stops and vehicles, return optimized routes
- **Driver assignment**: Automatically assign available drivers to orders based on proximity
- **Location tracking**: Update and retrieve driver locations in real-time
- **Integration testing**: Allow the `ros-adapter` service to test against predictable responses
- **Demo scenarios**: Provide realistic behavior for demonstrations without external dependencies

---

## What it exposes

### RESTful HTTP API

- **Base URL**: `http://localhost:4000` (configurable via `PORT` env var)
- **Content-Type**: `application/json`
- **Response format**: All responses follow `{ "success": true/false, "data": {...}, "error": "..." }` pattern

---

## Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Server configuration
PORT=4000
NODE_ENV=development

# Optional performance tuning
MIN_PROCESSING_DELAY=200
MAX_PROCESSING_DELAY=800
ERROR_SIMULATION_RATE=0.0
DEFAULT_DRIVER_CAPACITY=100
AVERAGE_SPEED_KMH=30
```

---

## API Endpoints

### 1. Health Check
**`GET /health`**

Returns server status and available endpoints.

```json
{
  "status": "healthy",
  "service": "ros-mock-server",
  "timestamp": "2023-09-18T10:00:00.000Z",
  "uptime": 3600,
  "endpoints": ["GET /health", "POST /api/ros/optimize", ...]
}
```

### 2. Route Optimization
**`POST /api/ros/optimize`**

Optimizes routes for multiple vehicles and stops.

**Request Body:**
```json
{
  "stops": [
    {
      "id": "pickup-1",
      "address": "123 Main St, NYC",
      "coordinates": { "latitude": 40.7128, "longitude": -74.0060 },
      "type": "pickup",
      "timeWindows": [{ "start": "09:00", "end": "17:00" }],
      "serviceTime": 300
    },
    {
      "id": "delivery-1",
      "address": "456 Broadway, NYC",
      "coordinates": { "latitude": 40.7589, "longitude": -73.9851 },
      "type": "delivery",
      "serviceTime": 180
    }
  ],
  "vehicles": [
    {
      "id": "vehicle-1",
      "startLocation": { "latitude": 40.7282, "longitude": -73.7949 },
      "capacity": { "weight": 1000, "volume": 50 },
      "maxDistance": 100,
      "maxTime": 28800
    }
  ],
  "profile": "balanced",
  "considerTraffic": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "optimized": true,
    "totalDistance": 25.5,
    "totalDuration": 3600,
    "totalCost": 63.75,
    "routes": [
      {
        "vehicleId": "vehicle-1",
        "distance": 25.5,
        "duration": 3600,
        "cost": 63.75,
        "steps": [
          {
            "id": "pickup-1",
            "type": "pickup",
            "location": {
              "address": "123 Main St, NYC",
              "coordinates": { "latitude": 40.7128, "longitude": -74.0060 }
            },
            "arrival": "2023-09-18T10:30:00.000Z",
            "departure": "2023-09-18T10:35:00.000Z",
            "distance": 12.3,
            "duration": 1800,
            "description": "pickup at 123 Main St, NYC"
          }
        ]
      }
    ],
    "metadata": {
      "provider": "ros-mock-server",
      "algorithm": "simple-sequential",
      "timestamp": "2023-09-18T10:00:00.000Z"
    }
  }
}
```

### 3. Driver Assignment
**`POST /api/ros/assign-driver`**

Assigns the nearest available driver to an order.

**Request Body:**
```json
{
  "orderId": "order-123",
  "pickupLocation": { "latitude": 40.7128, "longitude": -74.0060 },
  "deliveryLocation": { "latitude": 40.7589, "longitude": -73.9851 }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "driverId": "driver-001",
    "name": "John Smith",
    "vehicle": "van-001",
    "currentLocation": { "latitude": 40.7128, "longitude": -74.0060 },
    "distanceToPickup": 2.4,
    "etaToPickup": 288,
    "estimatedArrival": "2023-09-18T10:04:48.000Z",
    "contact": "+1-555-1234",
    "metadata": {
      "assignedAt": "2023-09-18T10:00:00.000Z",
      "orderId": "order-123"
    }
  }
}
```

### 4. Update Driver Location
**`POST /api/ros/drivers/:driverId/location`**

Updates a driver's current location.

**Request Body:**
```json
{
  "latitude": 40.7282,
  "longitude": -73.7949
}
```

**Response:**
```json
{
  "success": true,
  "message": "Location updated successfully",
  "data": {
    "driverId": "driver-001",
    "location": { "latitude": 40.7282, "longitude": -73.7949 },
    "timestamp": "2023-09-18T10:00:00.000Z"
  }
}
```

### 5. Get Driver Location
**`GET /api/ros/drivers/:driverId/location`**

Retrieves a driver's current location and status.

**Response:**
```json
{
  "success": true,
  "data": {
    "driverId": "driver-001",
    "name": "John Smith",
    "currentLocation": { "latitude": 40.7282, "longitude": -73.7949 },
    "status": "available",
    "lastLocationUpdate": "2023-09-18T10:00:00.000Z",
    "vehicle": "van-001"
  }
}
```

### 6. List All Drivers
**`GET /api/ros/drivers`**

Returns all drivers with their current status (admin endpoint).

**Response:**
```json
{
  "success": true,
  "data": {
    "drivers": [
      {
        "id": "driver-001",
        "name": "John Smith",
        "status": "available",
        "currentLocation": { "latitude": 40.7128, "longitude": -74.0060 },
        "vehicle": "van-001",
        "maxCapacity": 100,
        "skills": ["fragile", "heavy"]
      }
    ],
    "total": 4,
    "available": 3,
    "onTrip": 1
  }
}
```

### 7. Reset Driver Status
**`POST /api/ros/drivers/:driverId/reset`**

Resets a driver's status to 'available' (testing endpoint).

---

## Data Models

### Driver Model
```javascript
{
  id: 'driver-001',
  name: 'John Smith',
  status: 'available' | 'on-trip',
  currentLocation: { latitude: 40.7128, longitude: -74.0060 },
  vehicle: 'van-001',
  maxCapacity: 100,
  skills: ['fragile', 'heavy'],
  currentOrder: 'order-123', // when on-trip
  lastLocationUpdate: '2023-09-18T10:00:00.000Z'
}
```

### Route Step Model
```javascript
{
  id: 'pickup-1',
  type: 'pickup' | 'delivery',
  location: {
    address: '123 Main St, NYC',
    coordinates: { latitude: 40.7128, longitude: -74.0060 }
  },
  arrival: '2023-09-18T10:30:00.000Z',
  departure: '2023-09-18T10:35:00.000Z',
  distance: 12.3,
  duration: 1800,
  description: 'pickup at 123 Main St, NYC'
}
```

---

## Quick Start

### 1. Install Dependencies
```bash
cd mock-servers/ros_server
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env if needed
```

### 3. Start Server
```bash
# Development mode
npm run dev

# Production mode
npm start
```

### 4. Verify Server
```bash
curl http://localhost:4000/health
```

---

## Testing Examples

### Test Route Optimization
```bash
curl -X POST http://localhost:4000/api/ros/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "stops": [
      {
        "id": "pickup-1",
        "address": "123 Main St",
        "coordinates": {"latitude": 40.7128, "longitude": -74.0060},
        "type": "pickup"
      },
      {
        "id": "delivery-1",
        "address": "456 Broadway",
        "coordinates": {"latitude": 40.7589, "longitude": -73.9851},
        "type": "delivery"
      }
    ],
    "vehicles": [
      {
        "id": "vehicle-1",
        "startLocation": {"latitude": 40.7282, "longitude": -73.7949}
      }
    ]
  }'
```

### Test Driver Assignment
```bash
curl -X POST http://localhost:4000/api/ros/assign-driver \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "test-order-123",
    "pickupLocation": {"latitude": 40.7128, "longitude": -74.0060}
  }'
```

### Update Driver Location
```bash
curl -X POST http://localhost:4000/api/ros/drivers/driver-001/location \
  -H "Content-Type: application/json" \
  -d '{"latitude": 40.7500, "longitude": -73.9800}'
```

### List Available Drivers
```bash
curl http://localhost:4000/api/ros/drivers
```

---

## Docker Support

### Build and Run
```bash
# Build image
docker build -t ros-mock-server .

# Run container
docker run -p 4000:4000 -e PORT=4000 ros-mock-server
```

### Docker Compose
```yaml
services:
  ros-mock:
    build: ./mock-servers/ros_server
    ports:
      - "4000:4000"
    environment:
      - PORT=4000
      - NODE_ENV=development
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## Troubleshooting

### Common Issues

**Server not starting**
- Check if port 4000 is available: `netstat -an | grep 4000`
- Verify Node.js version: `node --version` (requires Node.js 14+)

**Route optimization returns empty routes**
- Ensure request includes both `stops` and `vehicles` arrays
- Check that coordinates are valid latitude/longitude values

**Driver assignment fails**
- Verify all drivers aren't already `on-trip`
- Use `GET /api/ros/drivers` to check driver availability
- Reset driver status: `POST /api/ros/drivers/:id/reset`

**Location updates fail**
- Ensure driver ID exists: check `GET /api/ros/drivers`
- Verify latitude/longitude are numbers, not strings

### Debug Mode
Set `NODE_ENV=development` for detailed console logging:
```bash
export NODE_ENV=development
npm start
```

---

## Integration Notes

### For ROS Adapter Integration

1. **Base URL Configuration**: Point your `ros-adapter` service to `http://ros-mock:4000` (Docker) or `http://localhost:4000` (local)

2. **Expected Request Format**: The mock server accepts the same request format as the `transformRouteRequestToROS` function in `ros-adapter/server.js`

3. **Response Transformation**: Responses match the expected format for `transformRouteResponseFromROS`

4. **Fallback Testing**: The mock simulates various scenarios including:
   - Successful optimizations with multiple routes
   - Driver availability/unavailability
   - Location tracking updates
   - Processing delays (200-800ms)

### Data Persistence

**Note**: All data is stored in-memory and resets on server restart. For persistent testing:

1. Use the reset endpoints to restore known states
2. Consider implementing database persistence for longer demo scenarios
3. Create initialization scripts to populate consistent test data

### Performance Considerations

- Mock server handles concurrent requests
- Simulated processing delays make demos more realistic
- No rate limiting implemented (suitable for testing environments)
- Memory usage scales with number of concurrent driver/route requests

---

## API Compatibility

This mock server is designed to be compatible with the SwiftTrack `ros-adapter` service expectations:

- Route optimization requests/responses match the adapter's transformation functions
- Driver assignment follows the expected workflow from `logistics-service`
- Location tracking supports real-time updates as expected by the tracking systems
- Health checks follow the standard format used across all SwiftTrack services

For questions or issues, check the SwiftTrack project documentation or examine the `ros-adapter` service code for integration examples.