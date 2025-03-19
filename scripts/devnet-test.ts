import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaGaslessVault } from "../target/types/solana_gasless_vault";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { expect } from "chai";
import * as fs from "fs";
import * as readline from "readline";

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Test parameters
const MINT_AMOUNT = 1_000_000_000;
const DEPOSIT_AMOUNT = 500_000_000;
const BORROW_AMOUNT = 300_000; // Must be divisible by 3

// Function to save keypairs to file
const saveKeypairs = (keypairs: { name: string; keypair: Keypair }[]) => {
  // Create directory if it doesn't exist
  if (!fs.existsSync("./keypairs")) {
    fs.mkdirSync("./keypairs");
  }

  // Save each keypair
  keypairs.forEach(({ name, keypair }) => {
    fs.writeFileSync(
      `./keypairs/${name}.json`,
      JSON.stringify(Array.from(keypair.secretKey))
    );
  });

  console.log("All keypairs saved to ./keypairs/ directory");
};

// Function to load keypairs from file
const loadKeypairs = (names: string[]): Keypair[] => {
  const keypairs: Keypair[] = [];

  names.forEach((name) => {
    try {
      const keypairData = fs.readFileSync(`./keypairs/${name}.json`, "utf-8");
      const secretKey = Uint8Array.from(JSON.parse(keypairData));
      keypairs.push(Keypair.fromSecretKey(secretKey));
    } catch (error) {
      console.error(`Failed to load keypair ${name}:`, error);
      process.exit(1);
    }
  });

  return keypairs;
};

// Ask a question and get user confirmation
const askQuestion = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

async function main() {
  // Check if keypairs directory already exists
  const keypairsExist = fs.existsSync("./keypairs");

  // Generate or load keypairs
  let vaultAuthority: Keypair;
  let borrower: Keypair;
  let feePayer: Keypair;
  let recipient1: Keypair;
  let recipient2: Keypair;
  let recipient3: Keypair;

  if (keypairsExist && fs.readdirSync("./keypairs").length > 0) {
    // Ask if user wants to use existing keypairs
    const useExisting = await askQuestion("Use existing keypairs? (y/n): ");

    if (useExisting.toLowerCase() === "y") {
      const keypairs = loadKeypairs([
        "vaultAuthority",
        "borrower",
        "feePayer",
        "recipient1",
        "recipient2",
        "recipient3",
      ]);
      [vaultAuthority, borrower, feePayer, recipient1, recipient2, recipient3] =
        keypairs;
      console.log("Loaded existing keypairs");
    } else {
      // Generate new keypairs
      vaultAuthority = Keypair.generate();
      borrower = Keypair.generate();
      feePayer = Keypair.generate();
      recipient1 = Keypair.generate();
      recipient2 = Keypair.generate();
      recipient3 = Keypair.generate();

      // Save keypairs
      saveKeypairs([
        { name: "vaultAuthority", keypair: vaultAuthority },
        { name: "borrower", keypair: borrower },
        { name: "feePayer", keypair: feePayer },
        { name: "recipient1", keypair: recipient1 },
        { name: "recipient2", keypair: recipient2 },
        { name: "recipient3", keypair: recipient3 },
      ]);
    }
  } else {
    // Generate new keypairs
    vaultAuthority = Keypair.generate();
    borrower = Keypair.generate();
    feePayer = Keypair.generate();
    recipient1 = Keypair.generate();
    recipient2 = Keypair.generate();
    recipient3 = Keypair.generate();

    // Save keypairs
    saveKeypairs([
      { name: "vaultAuthority", keypair: vaultAuthority },
      { name: "borrower", keypair: borrower },
      { name: "feePayer", keypair: feePayer },
      { name: "recipient1", keypair: recipient1 },
      { name: "recipient2", keypair: recipient2 },
      { name: "recipient3", keypair: recipient3 },
    ]);
  }

  // Configure the client to use devnet
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  // Display the addresses that need funding
  console.log("\n🔑 Test accounts that need funding (0.5 SOL each):");
  console.log("Vault Authority:", vaultAuthority.publicKey.toString());
  console.log("Borrower:      ", borrower.publicKey.toString());
  console.log("Fee Payer:     ", feePayer.publicKey.toString());
  console.log("Recipient 1:   ", recipient1.publicKey.toString());
  console.log("Recipient 2:   ", recipient2.publicKey.toString());
  console.log("Recipient 3:   ", recipient3.publicKey.toString());

  // Check current balances
  console.log("\nCurrent balances:");
  for (const [name, account] of [
    ["Vault Authority", vaultAuthority],
    ["Borrower", borrower],
    ["Fee Payer", feePayer],
    ["Recipient 1", recipient1],
    ["Recipient 2", recipient2],
    ["Recipient 3", recipient3],
  ] as [string, Keypair][]) {
    const balance = await connection.getBalance(account.publicKey);
    console.log(`${name}: ${balance / LAMPORTS_PER_SOL} SOL`);
  }

  // Wait for user to fund the accounts
  await askQuestion(
    "\nPlease fund these accounts with at least 0.5 SOL each, then press Enter to continue..."
  );

  // Re-check balances to make sure they're funded
  console.log("\nVerifying balances after funding:");
  let allFunded = true;
  for (const [name, account] of [
    ["Vault Authority", vaultAuthority],
    ["Borrower", borrower],
    ["Fee Payer", feePayer],
    ["Recipient 1", recipient1],
    ["Recipient 2", recipient2],
    ["Recipient 3", recipient3],
  ] as [string, Keypair][]) {
    const balance = await connection.getBalance(account.publicKey);
    const balanceInSol = balance / LAMPORTS_PER_SOL;
    console.log(`${name}: ${balanceInSol} SOL`);

    if (balanceInSol < 0.5) {
      console.log(
        `❌ ${name} needs additional funding (minimum 0.5 SOL recommended)`
      );
      allFunded = false;
    }
  }

  if (!allFunded) {
    const proceed = await askQuestion(
      "\nNot all accounts have the recommended 0.5 SOL. Proceed anyway? (y/n): "
    );
    if (proceed.toLowerCase() !== "y") {
      console.log("Test aborted. Please fund the accounts and try again.");
      process.exit(0);
    }
  }

  // Set up the Anchor provider with the vault authority as the default account
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(vaultAuthority),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace
    .SolanaGaslessVault as Program<SolanaGaslessVault>;

  // Find PDAs
  const [vaultPda] = await PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );

  const [whitelistPda] = await PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), vaultPda.toBuffer()],
    program.programId
  );

  console.log("\n🏦 Program Addresses:");
  console.log("Program ID:   ", program.programId.toString());
  console.log("Vault PDA:    ", vaultPda.toString());
  console.log("Whitelist PDA:", whitelistPda.toString());

  // Execute the tests
  console.log("\n🧪 Starting Devnet Tests...");

  try {
    // 1. Initialize vault
    console.log("\n1️⃣ Initializing vault...");
    const initTx = await program.methods
      .initialize()
      .accounts({
        authority: vaultAuthority.publicKey,
        vault: vaultPda,
        whitelist: whitelistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([vaultAuthority])
      .rpc();
    console.log("✅ Vault initialized! Transaction:", initTx);

    // Verify vault state
    const vaultAccount = await program.account.vault.fetch(vaultPda);
    console.log("   Authority:", vaultAccount.authority.toString());
    console.log("   Token Count:", vaultAccount.tokenCount.toString());

    // 2. Add borrower to whitelist
    console.log("\n2️⃣ Adding borrower to whitelist...");
    const whitelistTx = await program.methods
      .addToWhitelist(borrower.publicKey)
      .accounts({
        authority: vaultAuthority.publicKey,
        vault: vaultPda,
        whitelist: whitelistPda,
      })
      .signers([vaultAuthority])
      .rpc();
    console.log("✅ Borrower added to whitelist! Transaction:", whitelistTx);

    // 3. Create token mint and add to vault
    console.log("\n3️⃣ Creating token mint and adding to vault...");

    // Create token mint
    const mintKeypair = Keypair.generate();
    await createMint(
      connection,
      vaultAuthority,
      vaultAuthority.publicKey,
      vaultAuthority.publicKey,
      9, // 9 decimals
      mintKeypair
    );
    console.log("   Token mint created:", mintKeypair.publicKey.toString());

    // Find token vault PDA
    const [tokenVaultPda] = await PublicKey.findProgramAddressSync(
      [
        Buffer.from("token_vault"),
        vaultPda.toBuffer(),
        mintKeypair.publicKey.toBuffer(),
      ],
      program.programId
    );
    console.log("   Token vault PDA:", tokenVaultPda.toString());

    // Create token account for the vault
    const vaultTokenAccount = Keypair.generate();

    // Add token to vault
    const addTokenTx = await program.methods
      .addToken()
      .accounts({
        authority: vaultAuthority.publicKey,
        vault: vaultPda,
        mint: mintKeypair.publicKey,
        tokenVault: tokenVaultPda,
        tokenAccount: vaultTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([vaultAuthority, vaultTokenAccount])
      .rpc();
    console.log("✅ Token added to vault! Transaction:", addTokenTx);

    // 4. Create token accounts and mint tokens
    console.log("\n4️⃣ Creating token accounts and minting tokens...");

    // Create token account for authority
    const authorityTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        vaultAuthority,
        mintKeypair.publicKey,
        vaultAuthority.publicKey
      )
    ).address;
    console.log(
      "   Authority token account created:",
      authorityTokenAccount.toString()
    );

    // Mint tokens to authority
    await mintTo(
      connection,
      vaultAuthority,
      mintKeypair.publicKey,
      authorityTokenAccount,
      vaultAuthority.publicKey,
      MINT_AMOUNT
    );
    console.log(`   Minted ${MINT_AMOUNT} tokens to authority`);

    // Create token accounts for others
    const borrowerTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        vaultAuthority,
        mintKeypair.publicKey,
        borrower.publicKey
      )
    ).address;

    const recipient1TokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        vaultAuthority,
        mintKeypair.publicKey,
        recipient1.publicKey
      )
    ).address;

    const recipient2TokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        vaultAuthority,
        mintKeypair.publicKey,
        recipient2.publicKey
      )
    ).address;

    const recipient3TokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        vaultAuthority,
        mintKeypair.publicKey,
        recipient3.publicKey
      )
    ).address;

    console.log("   Created token accounts for all participants");

    // 5. Deposit tokens to vault
    console.log("\n5️⃣ Depositing tokens to vault...");
    const depositTx = await program.methods
      .depositTokens(new anchor.BN(DEPOSIT_AMOUNT))
      .accounts({
        depositor: vaultAuthority.publicKey,
        vault: vaultPda,
        mint: mintKeypair.publicKey,
        tokenVault: tokenVaultPda,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        depositorTokenAccount: authorityTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([vaultAuthority])
      .rpc();
    console.log(
      `✅ Deposited ${DEPOSIT_AMOUNT} tokens to vault! Transaction:`,
      depositTx
    );

    // 6. Execute borrower and distribute transaction
    console.log("\n6️⃣ Executing borrow and distribute transaction...");

    // Find borrower account PDA
    const [borrowerAccountPda] = await PublicKey.findProgramAddressSync(
      [
        Buffer.from("borrower"),
        vaultPda.toBuffer(),
        borrower.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Execute transaction
    const borrowTx = await program.methods
      .borrowAndDistribute(new anchor.BN(BORROW_AMOUNT))
      .accounts({
        borrower: borrower.publicKey,
        vault: vaultPda,
        whitelist: whitelistPda,
        borrowerAccount: borrowerAccountPda,
        mint: mintKeypair.publicKey,
        tokenVault: tokenVaultPda,
        vaultTokenAccount: vaultTokenAccount.publicKey,
        recipientTokenAccount1: recipient1TokenAccount,
        recipientTokenAccount2: recipient2TokenAccount,
        recipientTokenAccount3: recipient3TokenAccount,
        feePayer: feePayer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([borrower, feePayer])
      .rpc();
    console.log(
      `✅ Borrowed and distributed ${BORROW_AMOUNT} tokens! Transaction:`,
      borrowTx
    );

    // Verify recipient balances
    const expectedPerRecipient = BORROW_AMOUNT / 3;

    const recipient1Balance = await getAccount(
      connection,
      recipient1TokenAccount
    )
      .then((account) => Number(account.amount))
      .catch(() => 0);

    const recipient2Balance = await getAccount(
      connection,
      recipient2TokenAccount
    )
      .then((account) => Number(account.amount))
      .catch(() => 0);

    const recipient3Balance = await getAccount(
      connection,
      recipient3TokenAccount
    )
      .then((account) => Number(account.amount))
      .catch(() => 0);

    console.log("\n📊 Recipient token balances after distribution:");
    console.log(
      `   Recipient 1: ${recipient1Balance} (expected: ${expectedPerRecipient})`
    );
    console.log(
      `   Recipient 2: ${recipient2Balance} (expected: ${expectedPerRecipient})`
    );
    console.log(
      `   Recipient 3: ${recipient3Balance} (expected: ${expectedPerRecipient})`
    );

    if (
      recipient1Balance === expectedPerRecipient &&
      recipient2Balance === expectedPerRecipient &&
      recipient3Balance === expectedPerRecipient
    ) {
      console.log("\n🎉 SUCCESS! All tests passed.");
    } else {
      console.log("\n⚠️ WARNING: Token balances don't match expected values.");
    }

    // Save mint info for future reference
    const mintInfo = {
      mint: mintKeypair.publicKey.toString(),
      tokenVault: tokenVaultPda.toString(),
      vaultTokenAccount: vaultTokenAccount.publicKey.toString(),
      mintAuthority: vaultAuthority.publicKey.toString(),
      authorityTokenAccount: authorityTokenAccount.toString(),
    };

    fs.writeFileSync("./mint-info.json", JSON.stringify(mintInfo, null, 2));
    console.log("\nMint info saved to mint-info.json for future reference");
  } catch (error) {
    console.error("\n❌ Test failed with error:", error);
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
