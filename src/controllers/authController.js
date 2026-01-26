const axios = require("axios");
const querystring = require("querystring");
const config = require("../config/env");
const tokenService = require("../services/tokenService");
const agilysysService = require("../services/agilysysService");

exports.login = (req, res) => {
  const scopes =
    "customers:read,customers:write,properties:read,properties:write";
  const url = `https://sys.akia.com/oauth/authorize?client_id=${config.AKIA.CLIENT_ID}&scope=${scopes}&response_type=code&redirect_uri=${encodeURIComponent(config.AKIA.REDIRECT_URI)}`;
  res.redirect(url);
};

exports.callback = async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("No code provided in query params.");

  // We use this variable to track exactly where the code crashes
  let currentStep = "INIT";

  try {
    // --- STEP 1: Exchange Code for Token ---
    currentStep = "EXCHANGE_TOKEN";
    console.log(`[${currentStep}] Requesting token from Akia...`);

    const resAuth = await axios.post(
      `${config.AKIA.BASE_URL}/oauth/token`,
      querystring.stringify({
        code,
        grant_type: "authorization_code",
        client_id: config.AKIA.CLIENT_ID,
        client_secret: config.AKIA.CLIENT_SECRET,
        redirect_uri: config.AKIA.REDIRECT_URI,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const { access_token } = resAuth.data;

    // Safety check: Did we actually get a token?
    if (!access_token) {
      throw new Error(
        "Token response received but 'access_token' property is missing.",
      );
    }

    console.log(`[${currentStep}] Token received successfully.`);

    // --- STEP 2: Save Token ---
    currentStep = "SAVE_TOKEN";
    await tokenService.saveTokens(resAuth.data);

    // --- STEP 3: Fetch User Profile ---
    currentStep = "FETCH_USER";
    console.log(`[${currentStep}] Fetching /v3/me with token...`);

    const resMe = await axios.get(`${config.AKIA.BASE_URL}/v3/me`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
    });

    console.log(`[${currentStep}] User data retrieved.`);

    // Success Response
    res.send(
      `<h1>Login Success!</h1>
       <h3>User Data:</h3>
       <pre>${JSON.stringify(resMe.data, null, 2)}</pre>`,
    );
  } catch (error) {
    // --- Detailed Error Handling ---
    console.error(`FAILED AT STEP: [${currentStep}]`);

    let errorMessage = `Process failed at step: <b>${currentStep}</b><br><br>`;
    let errorDetails = {};

    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
      console.error("Headers:", error.response.headers);

      errorDetails = {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data, // This usually contains the specific API error message
      };

      errorMessage += `<b>HTTP Error:</b> ${error.response.status} ${error.response.statusText}<br>`;
      errorMessage += `<b>API Response:</b> <pre>${JSON.stringify(error.response.data, null, 2)}</pre>`;
    } else if (error.request) {
      // The request was made but no response was received
      console.error("No response received:", error.request);
      errorMessage += "<b>Network Error:</b> No response received from Akia.";
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error("Error Message:", error.message);
      errorMessage += `<b>Internal Error:</b> ${error.message}`;
    }

    // Send the detailed error to the browser so you can read it easily
    res.status(500).send(errorMessage);
  }
};

exports.registerWebhook = async (req, res) => {
  const MY_URL =
    "https://3d1ddc13-060d-4411-992a-9ad6545cdf18-dev.e1-us-east-azure.choreoapis.dev/amos-interfacing/bft-amos-dev/v1.0/webhook";

  try {
    const { token, session } = await agilysysService.getBookingAuth();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (session) headers["SessionId"] = session;

    const payload = {
      endpointUrl: MY_URL,
      eventTypes: [
        "RESERVATION_CREATED",
        "RESERVATION_UPDATED",
        "RESERVATION_CANCELLED",
        "CHECK_IN",
        "CHECK_OUT",
      ],
    };
    const apiRes = await axios.post(config.AGILYSYS.SUB_URL, payload, {
      headers,
    });
    res.send(
      `<pre>Webhook Registered!\n${JSON.stringify(apiRes.data, null, 2)}</pre>`,
    );
  } catch (e) {
    res
      .status(500)
      .send(
        `<pre>Error:\n${JSON.stringify(e.response?.data || e.message, null, 2)}</pre>`,
      );
  }
};
