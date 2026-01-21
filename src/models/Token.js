const mongoose = require("mongoose");

const tokenSchema = new mongoose.Schema({
  _id: { type: String, default: "akia_auth" },
  access_token: String,
  refresh_token: String,
  expires_at: Number,
});

module.exports = mongoose.model("Token", tokenSchema);
