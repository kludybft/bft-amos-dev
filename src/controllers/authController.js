const axios = require("axios");
const config = require("../config/env");
const tokenService = require("../services/tokenService");
const agilysysService = require("../services/agilysysService");

exports.login = (req, res) => {
  const scopes = "properties:read";

  const params = new URLSearchParams({
    client_id: config.AKIA.CLIENT_ID,
    scope: scopes,
    response_type: "code",
    redirect_uri: config.AKIA.REDIRECT_URI,
  });

  const authUrl = `https://sys.akia.com/oauth/authorize?${params.toString()}`;

  res.redirect(authUrl);
};

exports.callback = async (req, res) => {
  const { code } = req.query;

  if (!code) {
    console.error("Callback reached without an authorization code.");
    return res.status(400).send("No authorization code provided.");
  }

  try {
    const tokenParams = new URLSearchParams();
    tokenParams.append("grant_type", "authorization_code");
    tokenParams.append("code", code);
    tokenParams.append("client_id", config.AKIA.CLIENT_ID);
    tokenParams.append("client_secret", config.AKIA.CLIENT_SECRET);
    tokenParams.append("redirect_uri", config.AKIA.REDIRECT_URI);

    const resAuth = await axios.post(
      `${config.AKIA.BASE_URL}/oauth/token`,
      tokenParams.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    const { access_token, expires_in } = resAuth.data;

    if (!access_token) {
      console.error(
        "Akia responded but no access_token was found in data:",
        resAuth.data,
      );
      throw new Error("Token exchange failed: No access token in response.");
    }

    // Save tokens to your service -> db
    await tokenService.saveTokens(resAuth.data);

    console.log(`Token acquired: ${access_token}. Expires in: ${expires_in}s.`);

    return res.status(200).json({
      success: true,
      message: "Token validated and User Profile retrieved.",
    });
  } catch (e) {
    console.error("--- AUTHENTICATION FAILURE ---");

    if (e.response) {
      const status = e.response.status;
      const details = JSON.stringify(e.response.data);

      console.error(`Status: ${status}`);
      console.error(`Response Data: ${details}`);
      console.error(`Request Config: ${e.config.url}`);

      return res.status(status).json({
        error: "Akia API Error",
        status: status,
        details: e.response.data,
      });
    } else if (e.request) {
      console.error(
        "No response received from Akia. Network issue or incorrect BASE_URL.",
      );
      return res.status(504).send("Gateway Timeout: No response from Akia.");
    } else {
      console.error("Request Setup Error:", e.message);
      return res.status(500).send(`Application Error: ${e.message}`);
    }
  }
};
