const { Connection, PublicKey } = require("@solana/web3.js");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const connection = new Connection(process.env.SOLANA_WS_URL, "confirmed");
const RAYDIUM_AMM_PROGRAM_ID = new PublicKey(process.env.RAYDIUM_AMM_PROGRAM_ID);

let db;

async function connectToDatabase() {
    const mongoUri = process.env.MONGO_URI;
    const client = new MongoClient(mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
    try {
        await client.connect();
        db = client.db("bot");
        console.log("Connected to MongoDB successfully.");
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        process.exit(1);
    }
}

async function saveToMongo(tokenData) {
    try {
        if (!db) {
            throw new Error("Database connection is not initialized");
        }
        const collection = db.collection("raydium_lp_transactions");
        const result = await collection.insertOne(tokenData);

        if (result.acknowledged) {
            console.log("Token data saved to MongoDB:", result.insertedId);
        } else {
            console.error("Failed to save token data to MongoDB.");
        }
    } catch (error) {
        console.error("Error saving token data to MongoDB:", error.message);
    }
}

function invertCoinAndPcMint(tokenData) {
    const SPECIAL_COIN_MINT = "So11111111111111111111111111111111111111112";
    if (tokenData.coinMint === SPECIAL_COIN_MINT) {
        [tokenData.coinMint, tokenData.pcMint] = [tokenData.pcMint, tokenData.coinMint];
    }
    return tokenData;
}

async function processRaydiumLpTransaction(connection, signature) {
    try {
        // Fetch the transaction details with new version handling
        const transactionDetails = await connection.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });

        if (!transactionDetails) {
            console.error("No transaction details found for signature:", signature);
            return;
        }

        // Updated way to access transaction data
        const message = transactionDetails.transaction.message;

        // For newer versions of Solana
        const accounts = message.staticAccountKeys
            ? message.staticAccountKeys.map((key) => key.toString())
            : message.accountKeys.map((key) => key.toString());

        const instructions = message.compiledInstructions || message.instructions;

        if (!instructions) {
            console.error("No instructions found in transaction");
            return;
        }

        console.log("Transaction Message:", message);
        console.log("Accounts:", accounts);

        // Process each instruction
        for (const ix of instructions) {
            const programId = accounts[ix.programIdIndex];

            if (programId === RAYDIUM_AMM_PROGRAM_ID.toString() && ix.data.length > 0) {
                // Extract account indices (adjusted for possible different structure)
                const accountIndices = ix.accounts || ix.accountKeyIndexes;

                if (!accountIndices) {
                    console.error("No account indices found in instruction");
                    continue;
                }

                const mint0 = accounts[accountIndices[8]]; // Base token mint
                const mint1 = accounts[accountIndices[9]]; // Quote token mint
                const lpTokenMint = accounts[accountIndices[7]]; // LP token mint
                const deployer = accounts[accountIndices[17]]; // Deployer's address
                const poolId = accounts[accountIndices[4]]; // AMM pool ID
                const baseVault = accounts[accountIndices[10]]; // Base token vault
                const quoteVault = accounts[accountIndices[11]]; // Quote token vault
                const ammAuthority = accounts[accountIndices[5]]; // AMM authority
                const ammTarget = accounts[accountIndices[13]]; // AMM target orders
                const ammOpenOrder = accounts[accountIndices[6]]; // AMM open orders
                const marketProgram = accounts[accountIndices[15]]; // Serum market program
                const marketId = accounts[accountIndices[16]]; // Serum market ID

                let tokenData = {
                    programId: new PublicKey(accounts[accountIndices[0]]).toString(),
                    ammId: new PublicKey(poolId).toString(),
                    ammAuthority: new PublicKey(ammAuthority).toString(),
                    ammOpenOrders: new PublicKey(ammOpenOrder).toString(),
                    lpMint: new PublicKey(lpTokenMint).toString(),
                    coinMint: new PublicKey(mint0).toString(),
                    pcMint: new PublicKey(mint1).toString(),
                    coinVault: new PublicKey(baseVault).toString(),
                    pcVault: new PublicKey(quoteVault).toString(),
                    ammTargetOrders: new PublicKey(ammTarget).toString(),
                    serumMarket: new PublicKey(marketId).toString(),
                    serumProgram: new PublicKey(marketProgram).toString(),
                    deployer: new PublicKey(deployer).toString(),
                };

                tokenData = invertCoinAndPcMint(tokenData);

                await saveToMongo(tokenData);
                return tokenData;
            }
        }
    } catch (error) {
        if (error.message.includes("Cannot read properties of undefined (reading '_bn')")) {
            console.log("Encountered '_bn' error, ignoring transaction:", signature);
        } else {
            console.error("Error fetching/processing transaction:", error.message);
        }
    }
}

module.exports = {
    connectToDatabase,
    processRaydiumLpTransaction,
};
