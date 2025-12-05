const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");

//middleware
app.use(cors());
app.use(express.json());


// firebase admin initialization
const serviceAccount = require("./zap-shift-firebase-adminsdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



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
        const usersCollection = client.db('parcelDB').collection('users');
        const parcelCollection = client.db('parcelDB').collection('parcels');
        const paymentCollection = client.db('parcelDB').collection('payments');
        const ridersCollection = client.db('parcelDB').collection('riders');


        //custom middleware to verify admin
        const verifyFirebaseToken = async (req, res, next) => {
            try {
                const token = req?.headers?.authorization?.split(' ')[1];
                if (!token) {
                    return res.status(401).send({ error: true, message: 'unauthorized access' });
                }

                const decodedUser = await admin.auth().verifyIdToken(token);
                req.decodedEmail = decodedUser.email;
                next();
            } catch (err) {
                console.error('Firebase token verify error:', err);
                res.status(403).send({ error: true, message: 'forbidden access' });
            }
        };


        // users API
        app.post('/users', async (req, res) => {
            try {
                const { email } = req.body;
                const userExists = await usersCollection.findOne({ email });

                if (userExists) {
                    return res.status(200).send({ message: "User already exists", inserted: false });
                }

                const user = req.body;
                const result = await usersCollection.insertOne(user);
                res.send(result);
            } catch (error) {
                console.error("Error creating user:", error);
                res.status(500).send({ message: "Failed to Create Users" });
            }
        })

        // sort parcels by email id
        app.get('/parcels', verifyFirebaseToken, async (req, res) => {
            try {
                const userEmail = req.query.email;

                const query = userEmail ? { created_by: userEmail } : {};

                const parcels = await parcelCollection
                    .find(query)
                    .sort({ creation_date: -1 })  // NEWEST FIRST
                    .toArray();

                res.status(200).send(parcels);

            } catch (error) {
                console.error("Error fetching parcels:", error);
                res.status(500).send({ message: "Failed to retrieve parcels" });
            }
        });

        // get a specific parcel by ID
        app.get('/parcels/:id', verifyFirebaseToken, async (req, res) => {
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

        app.get('/riders/approved', async (req, res) => {
            try {
                const query = { status: 'approved' };

                const riders = await ridersCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(riders);

            } catch (error) {
                console.error("Error fetching approved riders:", error);
                res.status(500).send({ message: "Failed to fetch approved riders" });
            }
        });



        app.post('/parcels', verifyFirebaseToken, async (req, res) => {
            try {
                const newParcel = req.body;

                const result = await parcelCollection.insertOne(newParcel)
                res.status(201).send(result)
            } catch (error) {
                console.log('Error inserting parcel:', error);
                res.status(500).send({ message: "Failed to create parcel" })
            }
        });

        app.delete('/parcels/:id', verifyFirebaseToken, async (req, res) => {
            try {
                const id = req.params.id;

                const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });

                res.send(result);
            } catch (error) {
                console.log('Error Deleted parcel:', error);
                res.status(500).send({ message: "Failed to deleted parcel" })
            }
        });

        // Riders API
        app.post('/riders', async (req, res) => {
            try {
                const rider = req.body;

                if (!rider || !rider.email) {
                    return res.status(400).send({ message: "Rider email is required" });
                }

                // Step 1: Check if rider already exists
                const existingRider = await ridersCollection.findOne({ email: rider.email });

                if (existingRider) {
                    return res.status(409).send({
                        message: "You already have a Rider Profile. Duplicate creation not allowed."
                    });
                }

                // Step 2: Create new rider
                const result = await ridersCollection.insertOne(rider);
                res.status(201).send(result);

            } catch (error) {
                console.error("Error creating Rider:", error);
                res.status(500).send({ message: "New Rider creation failed" });
            }
        });

        app.get('/riders/pending', async (req, res) => {
            try {
                const query = { status: 'pending' };

                const riders = await ridersCollection.find(query).sort({ createdAt: -1 }).toArray();

                res.send(riders);

            } catch (error) {
                console.error("Error fetching riders:", error);
                res.status(500).send({ message: "Failed to fetch riders" });
            }
        });

        app.delete('/riders/:id', async (req, res) => {
            try {
                const id = req.params.id;

                const result = await ridersCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: "Rider not found" });
                }

                res.send({ message: "Rider deleted successfully" });

            } catch (error) {
                console.error("Error deleting rider:", error);
                res.status(500).send({ message: "Failed to delete rider" });
            }
        });


        app.patch('/riders/:id/approve', async (req, res) => {
            try {
                const id = req.params.id;

                // Rider approve status update
                const rider = await ridersCollection.findOne({ _id: new ObjectId(id) });
                if (!rider) {
                    return res.status(404).send({ message: "Rider not found" });
                }

                const result = await ridersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: 'approved' } }
                );

                // Update user role to 'rider' in users collection
                await usersCollection.updateOne(
                    { email: rider.email },
                    { $set: { role: 'rider' } }
                );

                if (result.modifiedCount === 0) {
                    return res.status(404).send({ message: "Rider not found or already approved" });
                }

                res.send({ message: "Rider approved & role updated successfully" });

            } catch (error) {
                console.error("Error approving rider:", error);
                res.status(500).send({ message: "Failed to approve rider" });
            }
        });

        app.patch('/riders/:id/deactivate', async (req, res) => {
            try {
                const id = req.params.id;

                const rider = await ridersCollection.findOne({ _id: new ObjectId(id) });
                if (!rider) {
                    return res.status(404).send({ message: "Rider not found" });
                }

                // Update rider status
                await ridersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "deactivated" } }
                );

                // Also remove rider role
                await usersCollection.updateOne(
                    { email: rider.email },
                    { $set: { role: "user" } }
                );

                res.send({ message: "Rider deactivated successfully" });

            } catch (error) {
                console.error("Error deactivating rider:", error);
                res.status(500).send({ message: "Failed to deactivate rider" });
            }
        });

        // Get all deactivated riders
        app.get('/riders/deactivated', async (req, res) => {
            try {
                const riders = await ridersCollection
                    .find({ status: "deactivated" })
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(riders);
            } catch (error) {
                console.error("Error fetching deactivated riders:", error);
                res.status(500).send({ message: "Failed to fetch deactivated riders" });
            }
        });


        app.patch('/riders/:id/activate', async (req, res) => {
            try {
                const id = req.params.id;

                const rider = await ridersCollection.findOne({ _id: new ObjectId(id) });
                if (!rider) {
                    return res.status(404).send({ message: "Rider not found" });
                }

                // Update rider status
                await ridersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "approved" } }
                );

                // Update user role to rider
                await usersCollection.updateOne(
                    { email: rider.email },
                    { $set: { role: "rider" } }
                );

                res.send({ message: "Rider activated successfully" });

            } catch (error) {
                console.error("Error activating rider:", error);
                res.status(500).send({ message: "Failed to activate rider" });
            }
        });






        // Create a Payment Intent
        app.post("/create-payment-intent", verifyFirebaseToken, async (req, res) => {
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


        app.get("/intent-status/:id", verifyFirebaseToken, async (req, res) => {
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
        app.patch("/parcel/payment-success/:parcelId", verifyFirebaseToken, async (req, res) => {
            try {
                const parcelId = req.params.parcelId;
                const { paymentIntentId, amount, userEmail, paymentMethod } = req.body;

                if (!paymentIntentId || !amount || !userEmail) {
                    return res.status(400).send({ message: "Missing payment details" });
                }

                const result = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            payment_status: "paid",
                            payment_method: paymentMethod,
                            payment_intent_id: paymentIntentId,
                            paid_amount: amount,
                            paid_at: new Date(),
                        }
                    }
                );

                if (result.modifiedCount === 0) {
                    return res.status(404).send({ message: "Parcel not found" });
                }

                // SAVE PAYMENT HISTORY
                const paymentDoc = {
                    parcelId,
                    paymentIntentId,
                    amount,
                    userEmail,
                    status: 'succeeded',
                    date: new Date(),
                }

                const paymentResult = await paymentCollection.insertOne(paymentDoc);

                res.send({ success: true, message: "Payment updated successfully & history saved", result, paymentResult });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to update payment" });
            }
        });


        // Payment API
        app.get("/payments", verifyFirebaseToken, async (req, res) => {
            try {
                const userEmail = req.query.email;

                if (!userEmail) {
                    return res.status(400).send({ message: "Email is required" });
                }

                const payments = await paymentCollection
                    .find({ userEmail })
                    .sort({ date: -1 })
                    .toArray();

                res.send(payments);

            } catch (error) {
                res.status(500).send({ message: "Failed to fetch payments" });
                console.error("Error fetching payments:", error);
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