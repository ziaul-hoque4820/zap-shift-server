const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

//middleware
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.ZAPSHIFT_DB_USER}:${process.env.ZAPSHIFT_DB_PASSWORD}@cluster0.kogn06a.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        // data collection
        const parcelCollection = client.db('parcelDB').collection('parcels');

        // Parcel API
        app.get('/parcels', async (req, res) => {
            const parcels = await parcelCollection.find().toArray();
            res.send(parcels);
        });

        app.post('/parcels', async (req, res) => {
            try {
                const newParcel = req.body;

                const result = await parcelCollection.insertOne(newParcel)
                res.status(201).send(result)
            } catch (error) {
                console.log('Error inserting parcel:', error);
                res.status(500).send({ message: "Failed to create parcel" })
            }
        });



        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Zap-Shift Server is Run successfully')
});

app.listen(port, () => {
    console.log(`Zap-Shift Server is running on, http://localhost:${port}`);
})