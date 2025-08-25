const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/money-tracker', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log(`MongoDB Connected: ${conn.connection.host}`);
        
        // Log database name
        console.log(`Database: ${conn.connection.name}`);
        
    } catch (error) {
        console.error('Database connection error:', error.message);
        
        // Log more specific error info
        if (error.code === 'ECONNREFUSED') {
            console.log('Make sure MongoDB is running on your system');
            console.log('Start MongoDB with: mongod --dbpath /path/to/your/db');
        }
        
        // Exit process with failure
        process.exit(1);
    }
};

// Handle connection events
mongoose.connection.on('connected', () => {
    console.log('Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
    console.log('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('Mongoose disconnected');
});

// Gracefully close the connection when the app terminates
process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('MongoDB connection closed through app termination');
    process.exit(0);
});

module.exports = connectDB;