const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const webhookController = require("../controllers/webhookController");

// Auth Routes
router.get("/auth/login", authController.login);
router.get("/auth/callback", authController.callback);

// Setup Route
router.get("/register-webhook", authController.registerWebhook);

// Main Webhook
router.post("/webhook", webhookController.webhook);

router.get("/me", authController.me);

module.exports = router;
