import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";

const app = express();
const PORT = 5000;

app.use(cors());
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
const studioCollection = db.collection("my-listings");
const bookingCollection = db.collection("bookings");

app.post("/add-studios", async (req, res) => {
  const studioData = req.body;
  const result = await studioCollection.insertOne(studioData);
  res.send(result);
});

app.get("/my-listings", async (req, res) => {
  const result = await studioCollection.find().toArray();
  res.send(result);
});

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

app.patch("/studios/:id", async (req, res) => {
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

app.delete("/studios/:id", async (req, res) => {
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

app.post("/bookings", async (req, res) => {
  try {
    const {
      studioId,
      studioTitle,
      category,
      bookingDate,
      timeSlot,
      totalAmount,
      customerEmail,
    } = req.body;

    if (
      !studioTitle ||
      !category ||
      !bookingDate ||
      !timeSlot ||
      !customerEmail ||
      !Number.isFinite(Number(totalAmount))
    ) {
      return res
        .status(400)
        .send({ message: "Missing or invalid booking data" });
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
    res.status(500).send({ message: "Failed to create booking" });
  }
});

app.get("/my-bookings", async (req, res) => {
  try {
    const { email } = req.query;
    const filter = email ? { customerEmail: email } : {};

    const bookings = await bookingCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(bookings);
  } catch (error) {
    console.error("Fetch bookings error:", error);
    res.status(500).send({ message: "Failed to fetch bookings" });
  }
});

app.get("/", (req, res) => {
  res.send({
    message: "Server is running",
  });
});

app.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});
