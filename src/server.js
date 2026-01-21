const express = require("express");
const connectDB = require("./config/db");
const apiRoutes = require("./routes/api");
const config = require("./config/env");

const app = express();

// Middleware
app.use(express.json());

// Database
connectDB();

// Routes
app.use("/", apiRoutes);

// Start Server
app.listen(config.PORT, () => {
  console.log(`Bridge running on port ${config.PORT}`);
});
