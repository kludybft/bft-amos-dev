const axios = require("axios");
const querystring = require("querystring");
const TokenModel = require("../models/Token");
const config = require("../config/env");

exports.saveTokens = async (data) => {
  const expiresInMs = (data.expires_in - 60) * 1000;
  await TokenModel.findByIdAndUpdate(
    "akia_auth",
    {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + expiresInMs,
    },
    { upsert: true, new: true },
  );
  console.log("Akia Tokens Saved.");
};

exports.getValidToken = async () => {
  const doc = await TokenModel.findById("akia_auth");
  if (!doc || !doc.access_token)
    throw new Error("Akia not authenticated. Visit /auth/login");

  // Refresh if expired
  if (Date.now() >= doc.expires_at) {
    try {
      const res = await axios.post(
        `${config.AKIA.BASE_URL}/oauth/token`,
        querystring.stringify({
          refresh_token: doc.refresh_token,
          grant_type: "refresh_token",
          client_id: config.AKIA.CLIENT_ID,
          client_secret: config.AKIA.CLIENT_SECRET,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );

      await exports.saveTokens(res.data);
      return res.data.access_token;
    } catch (e) {
      throw new Error("Akia Refresh Failed. Please re-login.");
    }
  }
  return doc.access_token;
};
