const express = require("express");
const connectDB = require("./config/db");
const apiRoutes = require("./routes/api");
const config = require("./config/env");

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use("/", apiRoutes);

// Conditional Start: Only connect and listen if this file is run directly.
// This prevents tests from starting the server and connecting to the live DB prematurely.
if (require.main === module) {
  connectDB();
  app.listen(config.PORT, () => {
    console.log(`Bridge running on port ${config.PORT}`);
  });
}

module.exports = app;
