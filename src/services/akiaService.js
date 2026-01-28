const axios = require("axios");
const config = require("../config/env");
const tokenService = require("./tokenService");

exports.send = async (endpoint, payload, method = "POST") => {
  try {
    const accessToken = await tokenService.getValidToken();
    const res = await axios({
      method,
      url: `${config.AKIA.BASE_URL}/${endpoint}`,
      data: payload,
      params: {
        access_token: accessToken,
      },
    });
    return res.data;
  } catch (e) {
    console.error(`Akia Failed: ${e.response?.status || e.message}`);
    return null;
  }
};
