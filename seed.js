import { MongoClient } from "mongodb";
import "dotenv/config";
import { readFileSync } from "node:fs";

const client = new MongoClient(
  `mongodb://${process.env.DB_URI}:${process.env.DB_PASS}@ac-k03dstd-shard-00-00.kgxk25v.mongodb.net:27017,ac-k03dstd-shard-00-01.kgxk25v.mongodb.net:27017,ac-k03dstd-shard-00-02.kgxk25v.mongodb.net:27017/?ssl=true&replicaSet=atlas-6jagwq-shard-0&authSource=admin`,
);

async function seedDatabase() {
  try {
    await client.connect();

    const db = client.db("studio-space");

    const studioCollection = db.collection("studios");
    const slideCollection = db.collection("homeSlides");

    const { slides, studios } = JSON.parse(
      readFileSync(
        new URL("./data/studio-data.json", import.meta.url),
        "utf-8",
      ),
    );

    // Remove only previous demo records
    await studioCollection.deleteMany({
      seedSource: "studio-space-demo",
    });

    await slideCollection.deleteMany({
      seedSource: "studio-space-demo",
    });

    // Insert studios with MongoDB-generated ObjectIds
    const studioDocuments = studios.map(({ _id, ...studio }) => ({
      ...studio,
      seedSource: "studio-space-demo",
      createdAt: new Date(),
    }));

    const studioResult = await studioCollection.insertMany(studioDocuments);

    // Insert home slider data
    const slideDocuments = slides.map((slide, index) => ({
      ...slide,
      position: index,
      seedSource: "studio-space-demo",
      createdAt: new Date(),
    }));

    await slideCollection.insertMany(slideDocuments);

    console.log("Successfully seeded StudioSpace!");
    console.log("Studios:", studioResult.insertedCount);
    console.log("Slides:", slides.length);
  } catch (error) {
    console.error("Database seeding failed:", error);
  } finally {
    await client.close();
  }
}

seedDatabase();
