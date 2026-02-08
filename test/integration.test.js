const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const axios = require("axios");

jest.mock("axios");

const app = require("../src/server");
const Token = require("../src/models/Token");

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  jest.clearAllMocks();
  await Token.deleteMany({});
});

const seedAuthToken = async () => {
  await Token.create({
    _id: "akia_auth",
    access_token: "valid-test-token",
    refresh_token: "valid-refresh",
    expires_at: Date.now() + 100000,
  });
};

const mockExternalApis = (agilysysOverrides = {}, folioItems = []) => {
  axios.post.mockImplementation((url) => {
    if (url.includes("rguest")) {
      return Promise.resolve({ data: { BearerToken: "mock-token" } });
    }

    if (url.includes("deals/search")) {
      return Promise.resolve({
        data: {
          results: [{ id: "existing-deal-123" }],
        },
      });
    }

    if (url.includes("objects/deals")) {
      return Promise.resolve({ data: { id: "new-deal-123" } });
    }

    return Promise.resolve({ data: {} });
  });

  axios.get.mockImplementation((url) => {
    if (url.includes("GetReservation")) {
      return Promise.resolve({
        data: {
          confirmationNumber: "1001",
          status: "RESERVED",
          guestInfo: { firstName: "Granular", lastName: "Test" },
          stayInfo: {
            arrivalDate: "2023-12-01",
            departureDate: "2023-12-04",
            guestCounts: { adults: 2, children: 0 },
          },
          offers: {
            roomType: "OceanView",
            price: 1000,
            nights: 3,
            ...agilysysOverrides.offers,
          },
          ...agilysysOverrides,
        },
      });
    }
    if (url.includes("FolioDetails")) {
      return Promise.resolve({ data: folioItems });
    }
    if (url.includes("associations")) {
      return Promise.resolve({ data: { results: [] } });
    }
    return Promise.resolve({ data: {} });
  });

  axios.patch.mockResolvedValue({ data: {} });
};

describe("Integration: Comprehensive Webhook Logic", () => {
  beforeEach(async () => {
    await seedAuthToken();
  });

  //  1. VALIDATION & ERROR HANDLING

  it("Flow 1: Validation - Should reject missing confirmation number", async () => {
    const res = await request(app)
      .post("/webhook")
      .send({ eventType: "NewReservation" });
    expect(res.text).toBe("No confirmation ID available");
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("Flow 2: Agilysys Failure - Should handle 404 from Hotel System gracefully", async () => {
    axios.post.mockResolvedValue({ data: { BearerToken: "token" } });
    axios.get.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app)
      .post("/webhook")
      .send({
        eventType: "NewReservation",
        confirmationNumber: "9999",
        guestInfo: { lastName: "Unknown" },
      });

    expect(res.text).toBe("Fetch Failed");
  });

  //  2. BUSINESS LOGIC: UPSERT (Create/Update)

  it("Flow 3: NewReservation - Should calculate NIGHTS and generate Line Items correctly", async () => {
    mockExternalApis({}, []);

    await request(app)
      .post("/webhook")
      .send({
        eventType: "NewReservation",
        confirmationNumber: "1001",
        guestInfo: { lastName: "Test" },
      });

    const hubSpotCalls = axios.post.mock.calls.filter((call) =>
      call[0].includes("objects/2-56446275"),
    );

    const nightItems = hubSpotCalls.filter(
      (call) => call[1].properties.item_type === "night",
    );

    expect(nightItems.length).toBe(3);
    expect(nightItems[0][1].properties.deal_item_name).toContain("Night 1");
    expect(nightItems[2][1].properties.deal_item_name).toContain("Night 3");
  });

  it("Flow 4: Spa vs Add-on Logic - Should distinguish items based on properties", async () => {
    const mockFolio = [
      {
        price: 150,
        therapistId: "Tera123",
        dealItemName: "Deep Tissue",
      },
      {
        price: 50,
        dealItemName: "Champagne",
        itemType: "addon",
      },
    ];

    mockExternalApis({ offers: { nights: 1 } }, mockFolio);

    await request(app)
      .post("/webhook")
      .send({
        eventType: "ModifyReservation",
        confirmationNumber: "1001",
        guestInfo: { lastName: "Test" },
      });

    const hubSpotCalls = axios.post.mock.calls.filter((call) =>
      call[0].includes("objects/2-56446275"),
    );

    const spaItem = hubSpotCalls.find(
      (call) => call[1].properties.item_type === "spa",
    );
    expect(spaItem).toBeDefined();
    expect(spaItem[1].properties.therapist_id).toBe("Tera123");

    const addonItem = hubSpotCalls.find(
      (call) => call[1].properties.item_type === "addon",
    );
    expect(addonItem).toBeDefined();
    expect(addonItem[1].properties.deal_item_name).toBe("Add-on");
  });

  //  3. BUSINESS LOGIC: STATUS UPDATES

  it('Flow 5: CheckedIn - Should map to specific pipeline Stage ID "1270278403"', async () => {
    mockExternalApis();

    await request(app)
      .post("/webhook")
      .send({
        eventType: "CheckedInReservation",
        confirmationNumber: "1001",
        guestInfo: { lastName: "Test" },
      });

    expect(axios.patch).toHaveBeenCalledWith(
      expect.stringContaining("objects/deals"),
      expect.objectContaining({
        properties: { dealstage: "1270278403" },
      }),
      expect.anything(),
    );
  });

  it('Flow 6: CancelReservation - Should map to "closedlost"', async () => {
    mockExternalApis();

    await request(app)
      .post("/webhook")
      .send({
        eventType: "CancelReservation",
        confirmationNumber: "1001",
        guestInfo: { lastName: "Test" },
      });

    expect(axios.patch).toHaveBeenCalledWith(
      expect.stringContaining("objects/deals"),
      expect.objectContaining({
        properties: { dealstage: "closedlost" },
      }),
      expect.anything(),
    );
  });

  it('Flow 7: CheckedOut - Should map to "1270278404"', async () => {
    mockExternalApis();
    await request(app)
      .post("/webhook")
      .send({
        eventType: "CheckedOutReservation",
        confirmationNumber: "1001",
        guestInfo: { lastName: "Test" },
      });

    expect(axios.patch).toHaveBeenCalledWith(
      expect.stringContaining("objects/deals"),
      expect.objectContaining({
        properties: { dealstage: "1270278404" },
      }),
      expect.anything(),
    );
  });

  //  4. EDGE CASE: THE "DEFAULT" FALLBACK

  it("Flow 8: Unknown Event Type - Should fallback to Agilysys Status (CANCELED)", async () => {
    mockExternalApis({ status: "canceled" });

    await request(app)
      .post("/webhook")
      .send({
        eventType: "SomeRandomEvent",
        confirmationNumber: "1001",
        guestInfo: { lastName: "Test" },
      });

    expect(axios.patch).toHaveBeenCalledWith(
      expect.stringContaining("objects/deals"),
      expect.objectContaining({
        properties: { dealstage: "closedlost" },
      }),
      expect.anything(),
    );
  });

  it("Flow 9: Unknown Event Type - Should fallback to Upsert if Agilysys is Active", async () => {
    mockExternalApis({ status: "RESERVED" });

    await request(app)
      .post("/webhook")
      .send({
        eventType: "SomeRandomEvent",
        confirmationNumber: "1001",
        guestInfo: { lastName: "Test" },
      });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("objects/deals"),
      expect.anything(),
      expect.anything(),
    );
  });
});
