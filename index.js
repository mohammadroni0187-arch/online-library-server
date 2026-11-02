
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
let newBooksCollection;
let borrowsCollection;
let booksCollection;

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

// My Books API
app.get('/my-book', async(req, res)=>{
  const result = await addBookCollection.find().toArray()
  res.send(result)
})

// New Arrivals API
app.get("/books/latest", async (req, res) => {
  try {
    const books = await newBooksCollection.find().sort({ createdAt: -1 }).limit(6).toArray();

    res.status(200).send(books);
  } catch (error) {
    console.error("Latest Books Error:", error);

    res.status(500).send({
      message: "Failed to fetch books",
    });
  }
});
// All Books API
app.get("/books", async (req, res) => {
  const books = await booksCollection.find().toArray();
  res.send(books);
});


// My Borrows API

app.get("/my-borrows", async (req, res) => {
  try {
    const email = req.query.email;

    const borrows = await borrowsCollection
      .find({ userEmail: email })
      .toArray();

    res.status(200).send(borrows);
  } catch (error) {
    res.status(500).send({
      message: "Failed to get borrowed books",
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
    newBooksCollection = db.collection("New-Book");
    booksCollection = db.collection("AllBooks");
    borrowsCollection = db.collection("Borrows");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

  } catch (error) {
    console.error("Server failed to start:", error);
    process.exit(1);
  }
}

startServer();
