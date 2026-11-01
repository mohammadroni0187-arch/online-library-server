
import express from 'express';
import { MongoClient } from 'mongodb';
import 'dotenv/config';
import cors from 'cors'

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(express.json());
app.use(cors());
// MongoDB Client
const client = new MongoClient(process.env.MONGODB_URI);
let addBookCollection;

// Database Connection
export async function connectToMongoDB() {
  try {
    await client.connect();

    console.log("Successfully connected to MongoDB!");

    return client;
  } catch (err) {
    console.error("MongoDB connection failed:", err);
    throw err;
  }
}

// Disconnect
export async function disconnectFromMongoDB() {
  await client.close();
  console.log("MongoDB disconnected!");
}
app.post('/add-destination', async (req, res) => {
  try {
    const data = req.body;

    const result = await addBookCollection.insertOne(data);

    console.log(result);

    res.status(201).send(result);
  } catch (error) {
    console.error("Error adding book:", error);

    res.status(500).send({
      message: "Failed to add book",
      error: error.message,
    });
  }
});


// http://localhost:8000/add-destination
app.get('/', (req, res) => {
  res.send('Hello World!');
});

// Start Server after Database Connection
async function startServer() {
  try {
   const mongoClient = await connectToMongoDB();
   const db =mongoClient.db("Bookk-Nook")
    addBookCollection = db.collection("Add-Book")

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

  } catch (error) {
    console.error("Server failed to start:", error);
    process.exit(1);
  }
}

startServer();
