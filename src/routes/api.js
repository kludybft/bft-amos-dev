const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const webhookController = require("../controllers/webhookController");

// Auth Routes
router.get("/auth/login", authController.login);
router.get("/auth/callback", authController.callback);

// Setup Route (One time use)
router.get("/setup-agilysys-webhook", authController.setupWebhook);

// Main Webhook
router.post("/webhook", webhookController.handleWebhook);

module.exports = router;
