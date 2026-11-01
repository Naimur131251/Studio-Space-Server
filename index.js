import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json());

const client = new MongoClient(
  `mongodb://${process.env.DB_URI}:${process.env.DB_PASS}@ac-k03dstd-shard-00-00.kgxk25v.mongodb.net:27017,ac-k03dstd-shard-00-01.kgxk25v.mongodb.net:27017,ac-k03dstd-shard-00-02.kgxk25v.mongodb.net:27017/?ssl=true&replicaSet=atlas-6jagwq-shard-0&authSource=admin`,
);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("studio-space");
const studioCollection = db.collection("studios");
const bookingCollection = db.collection("bookings");
const slideCollection = db.collection("homeSlides");

// JWKS একবার বাইরে ডিক্লেয়ার করা হলো (Best Practice)
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

// JWT Verification Middleware
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access!" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "Unauthorized access!" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.CLIENT_URL,
      audience: process.env.CLIENT_URL,
    });
    req.user = payload; // ইউজারের তথ্য রিকোয়েস্টে সেভ রাখা হলো
    next();
  } catch (error) {
    console.error("JWT ERROR:", error.code, error.message);

    return res.status(401).send({
      message: "Unauthorized access - Invalid token!",
    });
  }
};

// 0. Get Home Slider
app.get("/home", async (req, res) => {
  try {
    const slides = await slideCollection
      .find({})
      .sort({ position: 1 })
      .toArray();

    res.status(200).send({
      success: true,
      slides,
    });
  } catch (error) {
    console.error("Home slider error:", error);

    res.status(500).send({
      message: "Failed to fetch home slides",
    });
  }
});

// Get All Studios
app.get("/studios", async (req, res) => {
  try {
    const { category, search } = req.query;

    const filter = {};

    // Category filter
    if (category && category !== "All") {
      filter.category = category;
    }

    // Search filter
    if (search) {
      filter.$or = [
        {
          title: {
            $regex: search,
            $options: "i",
          },
        },
        {
          location: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const studios = await studioCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send({
      success: true,
      total: studios.length,
      studios,
    });
  } catch (error) {
    console.error("Fetch studios error:", error);

    res.status(500).send({
      message: "Failed to fetch studios",
    });
  }
});

// 1. Add Studio
app.post("/add-studios", verifyToken, async (req, res) => {
  try {
    const studioData = req.body;
    const result = await studioCollection.insertOne({
      ...studioData,
      createdAt: new Date(),
    });
    res.status(201).send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to add studio" });
  }
});

// 2. Get My Listings (User specific filter)
app.get("/my-listings", verifyToken, async (req, res) => {
  try {
    const email = req.query.email;
    const filter = email ? { ownerEmail: email } : {};
    const result = await studioCollection.find(filter).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch listings" });
  }
});

// 3. Get Single Studio Details
app.get("/studios/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: "Invalid studio ID" });

    const studio = await studioCollection.findOne({ _id: new ObjectId(id) });
    if (!studio) return res.status(404).send({ message: "Studio not found" });

    res.send(studio);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch studio" });
  }
});

// 4. Update Studio
app.patch("/studios/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: "Invalid studio ID" });

    const { amenities, ...data } = req.body;

    const result = await studioCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          ...data,
          hourlyRate: Number(data.hourlyRate),
          securityDeposit: Number(data.securityDeposit),
          maxCapacity: Number(data.maxCapacity),
          amenities: Array.isArray(amenities)
            ? amenities
            : (amenities || "")
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
          updatedAt: new Date(),
        },
      },
    );

    if (!result.matchedCount)
      return res.status(404).send({ message: "Studio not found" });

    res.send({ message: "Studio updated successfully!" });
  } catch (error) {
    res.status(500).send({ message: "Failed to update studio" });
  }
});

// 5. Delete Studio
app.delete("/studios/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: "Invalid studio ID" });

    const result = await studioCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (!result.deletedCount)
      return res.status(404).send({ message: "Studio not found" });

    res.send({ message: "Studio deleted successfully!" });
  } catch (error) {
    res.status(500).send({ message: "Failed to delete studio" });
  }
});

// 6. Create Booking (With Double-Booking Prevention)
app.post("/bookings", verifyToken, async (req, res) => {
  try {
    const {
      studioId,
      studioTitle,
      category,
      bookingDate,
      timeSlot,
      totalAmount,
    } = req.body;

    // Get email from verified JWT
    const customerEmail = req.user.email;

    if (
      !studioId ||
      !ObjectId.isValid(studioId) ||
      !bookingDate ||
      !timeSlot ||
      !Number.isFinite(Number(totalAmount)) ||
      Number(totalAmount) <= 0
    ) {
      return res.status(400).send({
        message: "Missing or invalid booking data",
      });
    }

    const existingBooking = await bookingCollection.findOne({
      studioId,
      bookingDate,
      timeSlot,
      status: { $in: ["Pending", "Confirmed"] },
    });

    if (existingBooking) {
      return res.status(400).send({
        message: "This studio slot is already booked or pending!",
      });
    }

    const booking = {
      studioId,
      studioTitle,
      category,
      bookingDate,
      timeSlot,
      totalAmount: Number(totalAmount),
      customerEmail,
      status: "Pending",
      createdAt: new Date(),
    };

    const result = await bookingCollection.insertOne(booking);

    res.status(201).send({
      message: "Booking created successfully!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Create booking error:", error);

    res.status(500).send({
      message: "Failed to create booking",
    });
  }
});

// 7. Get My Bookings (Secured with verifyToken)
app.get("/my-bookings", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;

    console.log("Logged in user:", email);

    const bookings = await bookingCollection
      .find({ customerEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    console.log("Found bookings:", bookings.length);

    res.status(200).send(bookings);
  } catch (error) {
    console.error("My bookings error:", error);

    res.status(500).send({
      message: "Failed to fetch bookings",
    });
  }
});

// 8. Cancel Booking (Secured with verifyToken)
app.patch("/bookings/:id/cancel", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: "Invalid booking ID" });

    const result = await bookingCollection.updateOne(
      { _id: new ObjectId(id), status: "Pending" },
      { $set: { status: "Cancelled", updatedAt: new Date() } },
    );

    if (!result.matchedCount) {
      return res.status(400).send({
        message: "Booking not found or cannot be cancelled",
      });
    }

    res.send({ message: "Booking cancelled successfully!" });
  } catch (error) {
    console.error("Cancel booking error:", error);
    res.status(500).send({ message: "Failed to cancel booking" });
  }
});

app.get("/", (req, res) => {
  res.send({
    message: "StudioSpace Server is running successfully!",
  });
});

app.listen(PORT, () => {
  console.log(`Server is running at port ${PORT}`);
});
