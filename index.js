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
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");

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
        const trackingsCollection = client.db('parcelDB').collection('trackings');


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

        // verify admin middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decodedEmail;

            if (!email) {
                return res.status(401).send({ message: "Unauthorized" });
            }

            const user = await usersCollection.findOne({ email });

            if (!user || user.role !== "admin") {
                return res.status(403).send({ message: "Access denied" });
            }

            next();
        };

        // verify Rider middleware
        const verifyRider = async (req, res, next) => {
            const email = req.decodedEmail;

            if (!email) {
                return res.status(401).send({ message: "Unauthorized" });
            }

            const user = await usersCollection.findOne({ email });

            if (!user || user.role !== "rider") {
                return res.status(403).send({ message: "Access denied" });
            }

            next();
        };




        // users API
        app.get('/users/search', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const emailQuery = req.query.email;
            if (!emailQuery) {
                return res.status(400).send({ message: "Email query parameter is required" });
            }

            const regex = new RegExp(emailQuery, 'i'); // 'i' for case-insensitive search

            try {
                const users = await usersCollection
                    .find({ email: { $regex: regex } })
                    // .project({ email: 1, createdAt: 1, role: 1 })
                    .limit(20)
                    .toArray();

                res.status(200).send(users);
            } catch (error) {
                console.error("Error searching users:", error);
                res.status(500).send({ message: "Failed to search users" });
            }
        })

        app.get('/users/:email/role', verifyFirebaseToken, async (req, res) => {
            try {
                const email = req.params.email;

                if (!email) {
                    return res.status(400).send({ message: "Email parameter is required" });
                }

                const user = await usersCollection.findOne({ email: email });

                if (!user) {
                    return res.status(404).send({ message: "User not found" });
                }

                res.status(200).send({ role: user.role || 'user' });
            } catch (error) {
                console.error("Error fetching user role:", error);
                res.status(500).send({ message: "Failed to get user role" });
            }
        })


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


        app.patch('/users/:id/role', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;
            if (!['user', 'admin'].includes(role)) {
                return res.status(400).send({ message: "Invalid role specified" });
            }

            try {
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );
                res.send({ message: `user role updated to ${role}`, result });
            } catch (error) {
                console.error("Error updating user role:", error);
                res.status(500).send({ message: "Failed to update user role" });
            }
        })

        // sort parcels by email id
        app.get('/parcels', verifyFirebaseToken, async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).send({ message: "Email required" });
                }

                const query = { created_by: email }

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


        app.get('/admin/parcels', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            try {
                const { payment_status, delivery_status } = req.query;

                let query = {};

                if (payment_status) query.payment_status = payment_status;
                if (delivery_status) query.delivery_status = delivery_status;

                const parcels = await parcelCollection
                    .find(query)
                    .sort({ creation_date: -1 })  // NEWEST FIRST
                    .toArray();

                res.status(200).send(parcels);
            } catch (error) {
                console.error("Error fetching parcels:", error);
                res.status(500).send({ message: "Error fetching admin parcels" });
            }
        })

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

        // Get parcel count by delivery status
        app.get('/parcels/delivery/status-count', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const pipeline = [
                {
                    $group: {
                        _id: '$delivery_status',
                        count: {
                            $sum: 1
                        }
                    }
                },
                {
                    $project: {
                        status: '$_id',
                        count: 1,
                        _id: 0
                    }
                }
            ];

            const result = await parcelCollection.aggregate(pipeline).toArray();
            res.send(result);
        })


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

        // Tracking API
        app.post("/trackings", verifyFirebaseToken, async (req, res) => {
            const update = req.body;

            update.timestamp = new Date(); // ensure correct timestamp
            if (!update.tracking_id || !update.status) {
                return res.status(400).json({ message: "tracking_id and status are required." });
            }

            const result = await trackingsCollection.insertOne(update);
            res.status(201).json(result);
        });

        app.get("/trackings/:trackingId", verifyFirebaseToken, async (req, res) => {
            try {
                const { trackingId } = req.params;

                if (!trackingId) {
                    return res.status(400).json({ message: "Tracking ID required" });
                }

                const updates = await trackingsCollection
                    .find({ tracking_id: trackingId })
                    .sort({ timestamp: 1 })
                    .toArray();

                if (!updates.length) {
                    return res.status(404).json({ message: "No tracking found" });
                }

                res.json(updates);
            } catch (error) {
                res.status(500).json({ message: "Failed to fetch tracking" });
            }
        });


        // Riders API
        app.post('/riders', verifyFirebaseToken, async (req, res) => {
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

        app.get('/riders/pending', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            try {
                const query = { status: 'pending' };

                const riders = await ridersCollection.find(query).sort({ createdAt: -1 }).toArray();

                res.send(riders);

            } catch (error) {
                console.error("Error fetching riders:", error);
                res.status(500).send({ message: "Failed to fetch riders" });
            }
        });

        app.get('/riders/approved', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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

        // Get available riders in a specific area
        app.get('/riders/available', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            try {
                const { area } = req.query;
                if (!area) return res.status(400).send({ message: "Area is required" });

                const normalizedArea = (area || "").trim();
                function escapeRegExp(string) {
                    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                }

                const found = await ridersCollection.find({
                    status: "approved",
                    $or: [
                        { work_status: { $exists: false } },
                        { work_status: "available" }
                    ],
                    areasToRide: { $in: [new RegExp(`^${escapeRegExp(normalizedArea)}$`, "i")] }
                }).sort({ appliedAt: -1 }).toArray();

                // map to frontend-friendly fields
                const riders = found.map(r => ({
                    _id: r._id.toString ? r._id.toString() : r._id,
                    name: r.name,
                    phone: r.contact,
                    areas: r.areasToRide || [],
                    status: r.status,
                    work_status: r.work_status
                }));

                res.send({ riders });

            } catch (error) {
                console.error("Error fetching available riders:", error);
                res.status(500).send({ message: "Failed to fetch available riders" });
            }
        });


        app.delete('/riders/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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


        // Assign rider to parcel
        app.patch('/parcels/:id/assign-rider', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            try {
                const parcelId = req.params.id;
                const { riderId } = req.body;

                if (!riderId) {
                    return res.status(400).send({ message: "Rider ID is required" });
                }

                // Find parcel
                const parcel = await parcelCollection.findOne({ _id: new ObjectId(parcelId) });
                if (!parcel) {
                    return res.status(404).send({ message: "Parcel not found" });
                }

                // Find rider
                const rider = await ridersCollection.findOne({ _id: new ObjectId(riderId) });
                if (!rider || rider.status !== "approved") {
                    return res.status(404).send({ message: "Rider not found or not approved" });
                }

                // Update parcel → assign rider
                const parcelUpdate = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            riderId: rider._id.toString(),
                            riderName: rider.name,
                            riderPhone: rider.contact,
                            riderEmail: rider.email,
                            delivery_status: "rider_assigned",
                            assigned_at: new Date()
                        }
                    }
                );

                // Update rider → mark as busy
                await ridersCollection.updateOne(
                    { _id: new ObjectId(riderId) },
                    { $set: { work_status: "busy" } }
                );

                res.send({ success: true, message: "Rider assigned successfully" });

            } catch (error) {
                console.error("Error assigning rider:", error);
                res.status(500).send({ message: "Failed to assign rider" });
            }
        });


        app.patch('/riders/:id/approve', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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

        app.patch('/riders/:id/deactivate', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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
        app.get('/riders/deactivated', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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


        app.patch('/riders/:id/activate', verifyFirebaseToken, verifyAdmin, async (req, res) => {
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


        // Parcels assigned to a rider {Riders Dashboard}
        app.get('/rider/parcels', verifyFirebaseToken, verifyRider, async (req, res) => {
            try {
                const email = req.decodedEmail;
                if (!email) {
                    return res.status(400).send({ message: "Rider email is required" });
                }

                const query = {
                    riderEmail: email,
                    delivery_status: { $in: ['rider_assigned', 'in_transit'] },
                }

                const optional = {
                    sort: { assigned_at: -1 }  // NEWEST FIRST
                };

                const parcels = await parcelCollection.find(query, optional).toArray();

                res.status(200).send(parcels);
            } catch (error) {
                console.error("Error fetching rider parcels:", error);
                res.status(500).send({ message: "Failed to retrieve rider parcels" });
            }
        })


        // Mark parcel as picked up by rider
        app.patch('/parcels/:id/pickup', verifyFirebaseToken, verifyRider, async (req, res) => {
            try {
                const parcelId = req.params.id;
                const { riderEmail } = req.body;

                if (!riderEmail) {
                    return res.status(400).json({ message: "Rider email is required" });
                }

                const filter = { _id: new ObjectId(parcelId) };

                const updateDoc = {
                    $set: {
                        delivery_status: "in_transit",   // UPDATED FIELD
                        pickedUpAt: new Date(),
                        pickedBy: riderEmail
                    }
                };

                const result = await parcelCollection.updateOne(filter, updateDoc);

                if (result.modifiedCount === 0) {
                    return res.status(404).json({ message: "Parcel not found or already picked" });
                }

                res.json({
                    message: "Parcel marked as picked up successfully",
                    parcelId,
                    delivery_status: "in_transit"
                });

            } catch (error) {
                console.error("Error updating parcel:", error);
                res.status(500).json({ message: "Server error while marking pickup" });
            }
        });

        // Mark parcel as delivered by rider
        app.patch('/parcels/:id/deliver', verifyFirebaseToken, verifyRider, async (req, res) => {
            try {
                const parcelId = req.params.id;
                const { riderEmail } = req.body;

                if (!riderEmail) {
                    return res.status(400).json({ message: "Rider email is required" });
                }

                // Find the parcel first
                const parcel = await parcelCollection.findOne({ _id: new ObjectId(parcelId) });

                if (!parcel) {
                    return res.status(404).json({ message: "Parcel not found" });
                }

                // Update parcel as delivered
                const result = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    {
                        $set: {
                            delivery_status: "delivered",
                            deliveredAt: new Date(),
                            deliveredBy: riderEmail
                        }
                    }
                );

                // Mark rider available again
                await ridersCollection.updateOne(
                    { email: riderEmail },
                    { $set: { work_status: "available" } }
                );

                res.json({
                    message: "Parcel delivered successfully",
                    parcelId,
                    delivery_status: "delivered"
                });

            } catch (error) {
                console.error("Error delivering parcel:", error);
                res.status(500).json({ message: "Failed to update parcel delivery" });
            }
        });

        // completed parcel deliveries for a rider
        app.get('/rider/completed-parcels', verifyFirebaseToken, verifyRider, async (req, res) => {
            try {
                const email = req.decodedEmail;

                if (!email) {
                    return res.status(400).send({ message: "Rider email is required" });
                }

                const query = {
                    riderEmail: email,
                    delivery_status: {
                        $in: ['delivered', 'service_center_delivered', 'returned']
                    }
                };
                const optional = {
                    sort: { deliveredAt: -1 }  // NEWEST FIRST
                };
                const parcels = await parcelCollection.find(query, optional).toArray();

                res.status(200).send(parcels);
            } catch (error) {
                console.error("Error fetching completed parcels:", error);
                res.status(500).send({ message: "Failed to retrieve completed parcels" });
            }
        })

        // Update parcel cashout status
        app.patch('/parcels/:id/cashout', verifyFirebaseToken, verifyFirebaseToken, async (req, res) => {
            try {
                const id = req.params.id;
                const result = await parcelCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            cashout_status: "cashed_out",
                            cash_out_at: new Date()
                        }
                    }
                );
                res.send({ message: "Cashout status updated", result });
            } catch (error) {
                console.error("Error updating cashout status:", error);
                res.status(500).send({ message: "Failed to update cashout status" });
            }
        })


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