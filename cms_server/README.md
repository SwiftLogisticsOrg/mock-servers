# CMS Mock Server

This is a mock implementation of the **Customer Management System (CMS)** for the Swift Logistics project.  
It simulates a SOAP/XML web service that exposes a minimal set of customer-related operations, allowing developers to integrate and test against a predictable backend without relying on the real CMS.

---

## 📌 Features

- SOAP/XML API endpoints for customer management.
- Example WSDL contract included.
- Lightweight mock responses (static or rule-based).
- Docker-ready for containerized development.

## ⚙️ Endpoints (SOAP Actions)

The mock server exposes the following SOAP operations:

1. **GetCustomerDetails**

   - **Input:** `customerId`
   - **Output:** Customer profile (name, email, phone, address).

2. **CreateCustomer**

   - **Input:** Customer details (name, email, NIC/passport, phone).
   - **Output:** Success + generated `customerId`.

3. **UpdateCustomer**

   - **Input:** `customerId` + fields to update.
   - **Output:** Updated customer profile.

4. **DeleteCustomer**
   - **Input:** `customerId`
   - **Output:** Acknowledgement (success/failure).

---
