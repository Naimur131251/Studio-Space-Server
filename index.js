import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);

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

await bookingCollection.createIndex(
  { activeSlotKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      activeSlotKey: { $type: "string" },
    },
  },
);

const parseTime = (value) => {
  const match = value?.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour !== 12) hour += 12;

  return hour * 60 + minute;
};

// JWKS initialization
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

// JWT Verification Middleware
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res
      .status(401)
      .send({ message: "Unauthorized access - Token missing!" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res
      .status(401)
      .send({ message: "Unauthorized access - Invalid header!" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.CLIENT_URL,
      audience: process.env.CLIENT_URL,
    });
    req.user = payload;
    next();
  } catch (error) {
    console.error("JWT VERIFY FAILED:", error.message);
    return res.status(401).send({
      message: `Unauthorized access - ${error.message}`,
    });
  }
};

// Auth JWT Read Only Host
app.get("/auth/me", verifyToken, (req, res) => {
  res.status(200).json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
    },
  });
});

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
    const { category, search, featured, limit } = req.query;
    const filter = {};

    if (category && category !== "All") {
      filter.category = category;
    }

    if (featured === "true") {
      filter.featured = true;
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
      ];
    }

    let studiosQuery = studioCollection
      .find(filter)
      .sort({ rating: -1, createdAt: -1 });

    if (limit) {
      const parsedLimit = Number(limit);
      if (Number.isInteger(parsedLimit) && parsedLimit > 0) {
        const finalLimit =
          featured === "true" ? Math.min(parsedLimit, 6) : parsedLimit;

        studiosQuery = studiosQuery.limit(finalLimit);
      }
    } else if (featured === "true") {
      studiosQuery = studiosQuery.limit(6);
    }

    const studios = await studiosQuery.toArray();
    res.status(200).send({
      success: true,
      total: studios.length,
      studios,
    });
  } catch (error) {
    console.error("Fetch studios error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch studios",
    });
  }
});

app.get("/studio-categories", async (req, res) => {
  try {
    const categories = await studioCollection.find().toArray();
    res.status(200).json({
      success: true,
      categories: categories || [],
    });
  } catch (error) {
    console.error("Database Fetch Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch categories",
      categories: [],
    });
  }
});

// 1. Add Studio
app.post("/add-studios", verifyToken, async (req, res) => {
  try {
    const email = req.user.email?.trim().toLowerCase();

    if (!email) {
      return res.status(401).send({
        message: "Authenticated user email not found.",
      });
    }

    const userId = req.user.sub || req.user.id || "";

    const { ownerEmail, ownerId, host, hostName, hostEmail, ...studioData } =
      req.body;

    const newStudio = {
      ...studioData,

      hourlyRate: Number(studioData.hourlyRate),
      securityDeposit: Number(studioData.securityDeposit),
      maxCapacity: Number(studioData.maxCapacity),

      ownerId: String(userId),
      ownerEmail: email,

      host: {
        name: req.user.name || email.split("@")[0],
        email,
        avatar: req.user.picture || req.user.image || "",
      },

      createdAt: new Date(),
    };

    const result = await studioCollection.insertOne(newStudio);

    res.status(201).send({
      success: true,
      message: "Studio added successfully!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Add studio error:", error);

    res.status(500).send({
      message: "Failed to add studio",
    });
  }
});

// 2. Get My Listings (Secured: Users can only see their own listings)
app.get("/my-listings", verifyToken, async (req, res) => {
  try {
    const email = req.user.email?.trim().toLowerCase();

    if (!email) {
      return res.status(401).send({
        message: "User email not found.",
      });
    }

    const result = await studioCollection
      .find({ ownerEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error("My listings error:", error);

    res.status(500).send({
      message: "Failed to fetch listings",
    });
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

// 4. Update Studio (Secured with Owner Verification)
app.patch("/studios/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: "Invalid studio ID" });

    // প্রথমে চেক করা হচ্ছে স্টুডিওটি কার
    const studio = await studioCollection.findOne({ _id: new ObjectId(id) });
    if (!studio) return res.status(404).send({ message: "Studio not found" });

    // Security Check: শুধুমাত্র ওনার নিজেই আপডেট করতে পারবেন
    if (studio.ownerEmail !== req.user.email) {
      return res
        .status(403)
        .send({ message: "Forbidden! You are not the owner of this studio." });
    }

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

    res.send({ message: "Studio updated successfully!" });
  } catch (error) {
    res.status(500).send({ message: "Failed to update studio" });
  }
});

// 5. Delete Studio (Secured with Owner Verification)
app.delete("/studios/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: "Invalid studio ID" });

    // প্রথমে চেক করা হচ্ছে স্টুডিওটি কার
    const studio = await studioCollection.findOne({ _id: new ObjectId(id) });
    if (!studio) return res.status(404).send({ message: "Studio not found" });

    // Security Check: শুধুমাত্র ওনার নিজেই ডিলিট করতে পারবেন
    if (studio.ownerEmail !== req.user.email) {
      return res
        .status(403)
        .send({ message: "Forbidden! You are not the owner of this studio." });
    }

    await studioCollection.deleteOne({ _id: new ObjectId(id) });
    res.send({ message: "Studio deleted successfully!" });
  } catch (error) {
    res.status(500).send({ message: "Failed to delete studio" });
  }
});

// 6. Create Booking (With Double-Booking Prevention)
app.post("/bookings", verifyToken, async (req, res) => {
  try {
    const email = req.user.email?.trim().toLowerCase();
    const userId = String(req.user.sub || req.user.id || "");

    const { studioId, bookingDate, startTime, hours } = req.body;

    if (!email || !studioId || !ObjectId.isValid(studioId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid booking information.",
      });
    }

    const duration = Number(hours);

    if (
      !bookingDate ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime || "") ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 12
    ) {
      return res.status(400).send({
        success: false,
        message: "Invalid date, time or duration.",
      });
    }

    const [hour, minute] = startTime.split(":").map(Number);
    const startMinutes = hour * 60 + minute;
    const endMinutes = startMinutes + duration * 60;

    // if (endMinutes > 1440) {
    //   return res.status(400).send({
    //     message: "Booking cannot extend beyond midnight.",
    //   });
    // }

    const studio = await studioCollection.findOne({
      _id: new ObjectId(studioId),
    });

    if (!studio) {
      return res.status(404).send({
        success: false,
        message: "Studio not found.",
      });
    }

    // Check existing overlapping bookings for the same studio and date
    const existingBookings = await bookingCollection
      .find({
        studioId,
        bookingDate,
        status: { $in: ["Pending", "Confirmed"] },
      })
      .toArray();

    const hasConflict = existingBookings.some((booking) => {
      let oldStart = booking.startMinutes;
      let oldEnd = booking.endMinutes;

      if (!Number.isFinite(oldStart) || !Number.isFinite(oldEnd)) {
        const [start, end] = (booking.timeSlot || "").split(" - ");
        oldStart = parseTime(start);
        oldEnd = parseTime(end);
      }

      if (oldStart === null || oldEnd === null) return false;

      return oldStart < endMinutes && oldEnd > startMinutes;
    });

    if (hasConflict) {
      return res.status(409).send({
        success: false,
        code: "SLOT_ALREADY_BOOKED",
        message:
          "Ei time-e already ekjon booking kore rekheche! Porer kono time-e booking korun.",
      });
    }

    const formatTime = (minutes) => {
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      const period = h >= 12 ? "PM" : "AM";
      const formattedHour = h % 12 || 12;

      return `${String(formattedHour).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
    };

    const timeSlot = `${formatTime(startMinutes)} - ${formatTime(endMinutes)}`;

    const booking = {
      studioId,
      studioTitle: studio.title,
      category: studio.category,
      customerId: userId,
      customerEmail: email, // User er email save hocche jate shudhu tar tai dekha jay
      bookingDate,
      startTime,
      startMinutes,
      endMinutes,
      timeSlot,
      totalAmount: Number(studio.hourlyRate) * duration,
      activeSlotKey: `${studioId}_${bookingDate}_${startMinutes}`,
      status: "Pending",
      createdAt: new Date(),
    };

    const result = await bookingCollection.insertOne(booking);

    res.status(201).send({
      success: true,
      message: "Booking created successfully!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).send({
        success: false,
        code: "SLOT_ALREADY_BOOKED",
        message:
          "Ei time-e already ekjon booking kore rekheche! Porer kono time-e booking korun.",
      });
    }

    console.error("Create booking error:", error);
    res.status(500).send({
      success: false,
      message: "Failed to create booking.",
    });
  }
});

// 7. Get My Bookings
app.get("/my-bookings", verifyToken, async (req, res) => {
  try {
    const email = req.user.email?.trim().toLowerCase();

    if (!email) {
      return res.status(401).send({
        message: "User email not found.",
      });
    }

    const bookings = await bookingCollection
      .find({ customerEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send(bookings);
  } catch (error) {
    console.error("My bookings error:", error);

    res.status(500).send({
      message: "Failed to fetch bookings.",
    });
  }
});

// 8. Cancel Booking (Secured: Only the person who booked can cancel)
app.patch("/bookings/:id/cancel", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: "Invalid booking ID" });

    // Security Check: চেক করা হচ্ছে এই বুকিংটি লগইন করা ইউজারের কি না
    const result = await bookingCollection.updateOne(
      {
        _id: new ObjectId(id),
        customerEmail: req.user.email.trim().toLowerCase(),
        status: "Pending",
      },
      {
        $set: {
          status: "Cancelled",
          updatedAt: new Date(),
        },
        $unset: {
          activeSlotKey: "",
        },
      },
    );

    if (!result.matchedCount) {
      return res.status(400).send({
        message:
          "Booking not found, already cancelled, or you don't have permission.",
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

export default app;
