import express from "express";
import { MongoClient } from "mongodb";
import "dotenv/config";
import cors from "cors";

const app = express();
const PORT = 8000;

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
const studioCollection = db.collection("studios");

app.get("/", (req, res) => {
  res.send({
    message: "Server is running",
  });
});


app.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});
