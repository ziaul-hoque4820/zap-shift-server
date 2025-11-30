const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 3000;

//middleware
app.use(cors());
app.use(express.json());

// stripe key
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

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
            const parcel = await parcelCollection.find().toArray();
            res.send(parcel);
        });

        // sort parcels by email id
        app.get('/parcels', async (req, res) => {
            try {
                const userEmail = req.query.email;

                const query = userEmail ? { created_by: userEmail } : {};

                const options = {
                    sort: { creation_date: -1 }
                };

                const parcels = await parcelCollection.find(query, options).toArray();

                res.status(200).send(parcels);

            } catch (error) {
                console.error("Error fetching parcels:", error);
                res.status(500).send({ message: "Failed to retrieve parcels" });
            }
        });

        // get a specific parcel by ID
        app.get('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;

                const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });

                if (!parcel) {
                    return res.status(400).send({ message: "Parcel not found" })
                }

                res.send(parcel);

            } catch (error) {
                console.error("Error fetching parcels:", error);
                res.status(500).send({ message: "Failed to get parcels" });
            }
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

        app.delete('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;

                const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });

                // if (result.deletedCount === 0) {
                //     return res.status(404).send({ message: "Parcel not found" });
                // }

                res.send(result);
            } catch (error) {
                console.log('Error Deleted parcel:', error);
                res.status(500).send({ message: "Failed to deleted parcel" })
            }
        });

        // Create a Payment Intent
        app.post("/create-payment-intent", async (req, res) => {
            try {
                const { amount } = req.body;
                console.log(amount);


                if (!amount || amount < 1) {
                    return res.status(400).send({ message: "Invalid amount" });
                }

                // Convert to cents (Stripe expects smallest currency unit)
                const convertedAmount = Math.round(amount * 100);

                const paymentIntent = await stripe.paymentIntents.create({
                    amount: convertedAmount,
                    currency: "usd",
                });

                res.send({
                    clientSecret: paymentIntent.client_secret
                });

            } catch (error) {
                console.error("Error creating payment intent:", error);
                res.status(500).send({ message: "Payment Intent creation failed" });
            }
        });


        app.get("/intent-status/:id", async (req, res) => {
            try {
                const intentId = req.params.id;

                const paymentIntent = await stripe.paymentIntents.retrieve(intentId);

                res.send({
                    id: paymentIntent.id,
                    status: paymentIntent.status
                });

            } catch (error) {
                console.error("Error fetching intent:", error);
                res.status(500).send({ message: "Failed to get payment intent" });
            }
        });

        // Update parcel payment status
        app.patch("/parcel/payment-success/:parcelId", async (req, res) => {
            try {
                const parcelId = req.params.parcelId;
                const { paymentIntentId, amount, userEmail } = req.body;

                if (!paymentIntentId || !amount || !userEmail) {
                    return res.status(400).send({ message: "Missing payment details" });
                }

                const result = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            payment_status: "paid",
                            payment_intent_id: paymentIntentId,
                            paid_amount: amount,
                            paid_at: new Date(),
                        }
                    }
                );

                if (result.modifiedCount === 0) {
                    return res.status(404).send({ message: "Parcel not found" });
                }

                res.send({ success: true, message: "Payment updated successfully" });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to update payment" });
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