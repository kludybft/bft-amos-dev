const axios = require("axios");
const config = require("../config/env");

const HS = config.HUBSPOT.PIPELINE_CONFIG;

// Push deal create or update
exports.pushDeal = async (data, extraUpdates = {}) => {
  const logId = data.confirmationNumber;

  try {
    // Search for existing deal
    const dealId = await findDealIdByConfirmationNumber(logId);

    // Prepare props to match HS props
    const dealProperties = {
      dealname: `${data.lastName} ${logId}`,
      confirmation_number: data.confirmationNumber,
      arrival_date: data.arrivalDate,
      villa_type: data.villaType,
      villa: data.villaNumber,
      origin_code: data.origin,
      segment_1: data.segment,
      deposit_schedule: data.depositSchedule, // not sure if createDate is the right one here,
      // cxl_policy: data.cxlPolicy, no cxl policy yet on Agilysys Versa Book API response
      guest_type: data.guestType,
      ...extraUpdates,
    };

    if (data.departureDate) {
      dealProperties.closedate = new Date(data.departureDate).getTime();
    }

    let currentDealId = dealId;

    // UPDATE or CREATE Logic
    if (currentDealId) {
      await axios.patch(
        `https://api.hubapi.com/crm/v3/objects/deals/${currentDealId}`,
        { properties: dealProperties },
        { headers: { Authorization: `Bearer ${config.HUBSPOT.TOKEN}` } },
      );

      // 2. Clear old line items
      // If dates changed, we must remove old "Night" items to avoid duplicates.
      await deleteAssociatedLineItems(currentDealId);
    } else {
      console.log(`HubSpot: Creating NEW Deal`);

      // Add "Create-only" defaults
      dealProperties.pipeline = HS.default_pipeline;
      dealProperties.dealstage = HS.initial_stage;

      const createRes = await axios.post(
        "https://api.hubapi.com/crm/v3/objects/deals",
        { properties: dealProperties },
        { headers: { Authorization: `Bearer ${config.HUBSPOT.TOKEN}` } },
      );

      currentDealId = createRes.data.id;
    }

    // D. PROCESS LINE ITEMS (Nights, Add-ons, Spa)
    const itemsToProcess = data.items || [];

    if (currentDealId && itemsToProcess.length > 0) {
      console.log(
        `HubSpot: Adding ${itemsToProcess.length} line items to Deal ${currentDealId}`,
      );

      for (const item of itemsToProcess) {
        await createUnifiedLineItem(currentDealId, item);
      }
    }
  } catch (e) {
    console.error("HubSpot Push Error:", e.response?.data || e.message);
    throw e;
  }
};

// 2. Update deal status
exports.updateDealStatus = async (confirmationNumber, newStageId) => {
  try {
    const dealId = await findDealIdByConfirmationNumber(confirmationNumber);

    if (!dealId) {
      console.warn(
        `HubSpot: Cannot cancel. Deal ${confirmationNumber} not found.`,
      );
      return;
    }

    await axios.patch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
      { properties: { dealstage: newStageId } },
      { headers: { Authorization: `Bearer ${config.HUBSPOT.TOKEN}` } },
    );

    console.log(`HubSpot: Deal ${dealId} moved to stage: ${newStageId}`);
  } catch (e) {
    console.error(
      "HubSpot Status Update Error:",
      e.response?.data || e.message,
    );
  }
};

// Helper Functions

// Helper: Find Deal ID by Confirmation Number property
async function findDealIdByConfirmationNumber(confNum) {
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
                value: confNum,
              },
            ],
          },
        ],
        limit: 1,
      },
      { headers: { Authorization: `Bearer ${config.HUBSPOT.TOKEN}` } },
    );
    return searchRes.data.results[0]?.id || null;
  } catch (e) {
    console.error("HubSpot Search Error:", e.message);
    return null;
  }
}

// Helper: Delete all line items associated with a deal
async function deleteAssociatedLineItems(dealId) {
  try {
    // 1. Get associated line items
    const assocRes = await axios.get(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}/associations/line_items`,
      { headers: { Authorization: `Bearer ${config.HUBSPOT.TOKEN}` } },
    );

    const results = assocRes.data.results;
    if (!results || results.length === 0) return;

    const lineItemIds = results.map((r) => ({ id: r.id }));

    // 2. Batch Delete
    await axios.post(
      "https://api.hubapi.com/crm/v3/objects/line_items/batch/archive",
      { inputs: lineItemIds },
      { headers: { Authorization: `Bearer ${config.HUBSPOT.TOKEN}` } },
    );

    console.log(`HubSpot: Cleared ${lineItemIds.length} old line items.`);
  } catch (e) {
    if (e.response?.status !== 404) {
      console.warn("HubSpot Line Item Cleanup Warning:", e.message);
    }
  }
}

// Helper: Create a single Line Item and associate it
async function createUnifiedLineItem(dealId, item) {
  const properties = {
    // Standard HubSpot Fields
    confirmation_number: item.confirmationNumber || null,
    name: item.dealItemName,
    price: item.price || "0",
    quantity: "1",

    // Common Custom Fields
    item_type: item.itemType || null,
    tax_amount: item.taxAmount || null,
    deposit_policy: item.depositPolicy || null,
    sales_rep_hs_id: item.salesRepHsId || null,
    sales_rep_ag_id: item.salesRepAgId || null,

    // Spa Specific Fields
    start_date_time: item.startDateTime || null,
    end_date_time: item.endDateTime || null,
    spa_service: item.spaService || null,
    gratuity_amount: item.gratuityAmount || null,
    therapist_id: item.therapistId || null,

    // Existing Specific Fields
    date_of_night: item.dateOfNight || null,
    villa_type: item.villaType || null,
    post_type: item.postType || null,
    assigned_room: item.assignedRoom || null,
  };

  const payload = {
    properties,
    associations: [
      {
        to: { id: dealId },
        types: [
          {
            associationCategory: "HUBSPOT_DEFINED",
            associationTypeId: 20,
          },
        ],
      },
    ],
  };

  try {
    await axios.post(
      "https://api.hubapi.com/crm/v3/objects/line_items",
      payload,
      { headers: { Authorization: `Bearer ${config.HUBSPOT.TOKEN}` } },
    );
  } catch (error) {
    console.error(
      ` ! Failed to create item "${item.dealItemName}":`,
      error.response?.data?.message || error.message,
    );
  }
}
