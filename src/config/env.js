require("dotenv").config();

module.exports = {
  // Global Settings
  PORT: process.env.PORT || 8080,
  MONGODB_URI: process.env.MONGODB_URI,

  // Akia
  AKIA: {
    BASE_URL: "https://api.akia.com",
    CLIENT_ID: process.env.AKIA_CLIENT_ID,
    CLIENT_SECRET: process.env.AKIA_CLIENT_SECRET,
    REDIRECT_URI: process.env.REDIRECT_URI,
  },

  // HubSpot
  HUBSPOT: {
    TOKEN: process.env.HUBSPOT_TOKEN,
    PIPELINE_CONFIG: {
      default_pipeline: "default",
      initial_stage: "appointmentscheduled",
      prop_confirmation_number: "confirmation_number",
      prop_akia_url: "akia_url",
    },
  },

  // Agilysys
  AGILYSYS: {
    BOOKING_AUTH_URL: "https://api.rguest.com/versa/auth/v1/authorize",
    BOOKING_URL: "https://api.rguest.com/versa/booking/v1",
    SPA_AUTH_URL: "https://api.rguest.com/spa/authservice/v1/authorize",
    SPA_URL: "https://api.rguest.com/spaservices/appointments/source",
    SUB_URL: "https://api.rguest.com/platform/v1/subscriptions",
    CREDENTIALS: {
      Client: process.env.AGILYSYS_CLIENT,
      ClientSecret: process.env.AGILYSYS_SECRET,
      ProductId: process.env.AGILYSYS_PRODUCT_ID,
      PropertyId: process.env.AGILYSYS_PROPERTY_ID,
      TenantId: process.env.AGILYSYS_TENANT_ID,
    },
  },
};
