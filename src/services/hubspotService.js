const axios = require("axios");
const config = require("../config/env");

const HS = config.HUBSPOT.PIPELINE_CONFIG;

exports.pushDeal = async (data, updates = {}) => {
  console.log(`HubSpot Push for Res ID: ${data.res_id}`);
  try {
    const searchRes = await axios.post(
      "https://api.hubapi.com/crm/v3/objects/deals/search",
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: HS.prop_confirmation_number,
                operator: "EQ",
                value: data.confirmation_number,
              },
            ],
          },
        ],
        limit: 1,
      },
      { headers: { Authorization: `Bearer ${config.HUBSPOT.TOKEN}` } },
    );

    const deal = searchRes.data.results[0];
    const properties = { ...updates };

    if (deal) {
      console.log(`HubSpot: Updating Deal ${deal.id}`);
      await axios.patch(
        `https://api.hubapi.com/crm/v3/objects/deals/${deal.id}`,
        { properties },
        { headers: { Authorization: `Bearer ${config.HUBSPOT.TOKEN}` } },
      );
    } else {
      console.log(`HubSpot: Creating NEW Deal`);
      properties.dealname = `Stay: ${data.guest_last} (${data.res_id})`;
      properties.pipeline = HS.default_pipeline;
      properties.dealstage = HS.initial_stage;
      properties[HS.prop_res_id] = data.res_id;

      if (data.total_price) properties.amount = data.total_price;
      if (data.departure_date)
        properties.closedate = new Date(data.departure_date).getTime();

      await axios.post(
        "https://api.hubapi.com/crm/v3/objects/deals",
        { properties },
        { headers: { Authorization: `Bearer ${config.HUBSPOT.TOKEN}` } },
      );
    }
  } catch (e) {
    console.error("HubSpot Error:", e.response?.data || e.message);
  }
};
