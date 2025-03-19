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

describe("solana-gasless-vault", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaGaslessVault as Program<SolanaGaslessVault>;

  // Test accounts
  const vaultAuthority = Keypair.generate();
  const borrower = Keypair.generate();
  const feePayer = Keypair.generate();
  const recipient1 = Keypair.generate();
  const recipient2 = Keypair.generate();
  const recipient3 = Keypair.generate();

  // PDAs
  let vaultPda: PublicKey;
  let whitelistPda: PublicKey;
  let tokenVaultPda: PublicKey;
  let borrowerAccountPda: PublicKey;

  // Token accounts
  let mintKeypair: Keypair;
  let vaultTokenAccount: Keypair;
  let authorityTokenAccount: PublicKey;
  let borrowerTokenAccount: PublicKey;
  let recipient1TokenAccount: PublicKey;
  let recipient2TokenAccount: PublicKey;
  let recipient3TokenAccount: PublicKey;

  // Test parameters
  const MINT_AMOUNT = 1_000_000_000;
  const DEPOSIT_AMOUNT = 500_000_000;
  const BORROW_AMOUNT = 300_000; // Must be divisible by 3

  before(async () => {
    // Airdrop SOL to accounts
    const accounts = [vaultAuthority, borrower, feePayer, recipient1, recipient2, recipient3];
    for (const account of accounts) {
      const airdropSig = await provider.connection.requestAirdrop(
        account.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);
    }

    // Find PDAs
    [vaultPda] = await PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId
    );

    [whitelistPda] = await PublicKey.findProgramAddressSync(
      [Buffer.from("whitelist"), vaultPda.toBuffer()],
      program.programId
    );

    console.log("🔑 Generated test accounts:");
    console.log("Vault Authority:", vaultAuthority.publicKey.toString());
    console.log("Borrower:", borrower.publicKey.toString());
    console.log("Fee Payer:", feePayer.publicKey.toString());
    console.log("Vault PDA:", vaultPda.toString());
    console.log("Whitelist PDA:", whitelistPda.toString());
  });

  it("Initialize vault", async () => {
    await program.methods
      .initialize()
      .accounts({
        authority: vaultAuthority.publicKey,
        vault: vaultPda,
        whitelist: whitelistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([vaultAuthority])
      .rpc();

    // Verify vault state
    const vaultAccount = await program.account.vault.fetch(vaultPda);
    expect(vaultAccount.authority.toString()).to.equal(vaultAuthority.publicKey.toString());
    expect(vaultAccount.tokenCount.toString()).to.equal("0");

    // Verify whitelist state
    const whitelistAccount = await program.account.whitelist.fetch(whitelistPda);
    expect(whitelistAccount.addresses.length).to.equal(0);
    expect(whitelistAccount.vault.toString()).to.equal(vaultPda.toString());
  });

  it("Add borrower to whitelist", async () => {
    await program.methods
      .addToWhitelist(borrower.publicKey)
      .accounts({
        authority: vaultAuthority.publicKey,
        vault: vaultPda,
        whitelist: whitelistPda,
      })
      .signers([vaultAuthority])
      .rpc();

    // Verify whitelist includes borrower
    const whitelistAccount = await program.account.whitelist.fetch(whitelistPda);
    expect(whitelistAccount.addresses.length).to.equal(1);
    expect(whitelistAccount.addresses[0].toString()).to.equal(borrower.publicKey.toString());
  });

  it("Create token mint and add to vault", async () => {
    // Create token mint
    mintKeypair = Keypair.generate();
    await createMint(
      provider.connection,
      vaultAuthority,
      vaultAuthority.publicKey,
      vaultAuthority.publicKey,
      9, // 9 decimals
      mintKeypair
    );

    // Find token vault PDA
    [tokenVaultPda] = await PublicKey.findProgramAddressSync(
      [Buffer.from("token_vault"), vaultPda.toBuffer(), mintKeypair.publicKey.toBuffer()],
      program.programId
    );

    // Create vault token account
    vaultTokenAccount = Keypair.generate();

    // Add token to vault
    await program.methods
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

    // Verify token vault state
    const tokenVaultAccount = await program.account.tokenVault.fetch(tokenVaultPda);
    expect(tokenVaultAccount.mint.toString()).to.equal(mintKeypair.publicKey.toString());
    expect(tokenVaultAccount.tokenAccount.toString()).to.equal(vaultTokenAccount.publicKey.toString());
    expect(tokenVaultAccount.vault.toString()).to.equal(vaultPda.toString());

    // Verify vault token count
    const vaultAccount = await program.account.vault.fetch(vaultPda);
    expect(vaultAccount.tokenCount.toString()).to.equal("1");
  });

  it("Create token accounts and mint tokens", async () => {
    // Create token account for authority
    authorityTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        vaultAuthority,
        mintKeypair.publicKey,
        vaultAuthority.publicKey
      )
    ).address;

    // Mint tokens to authority
    await mintTo(
      provider.connection,
      vaultAuthority,
      mintKeypair.publicKey,
      authorityTokenAccount,
      vaultAuthority.publicKey,
      MINT_AMOUNT
    );

    // Create token accounts for borrower and recipients
    borrowerTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        vaultAuthority,
        mintKeypair.publicKey,
        borrower.publicKey
      )
    ).address;

    recipient1TokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        vaultAuthority,
        mintKeypair.publicKey,
        recipient1.publicKey
      )
    ).address;

    recipient2TokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        vaultAuthority,
        mintKeypair.publicKey,
        recipient2.publicKey
      )
    ).address;

    recipient3TokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        vaultAuthority,
        mintKeypair.publicKey,
        recipient3.publicKey
      )
    ).address;

    // Check authority token balance
    const authorityTokenAccountInfo = await getAccount(
      provider.connection,
      authorityTokenAccount
    );
    expect(Number(authorityTokenAccountInfo.amount)).to.equal(MINT_AMOUNT);
  });

  it("Deposit tokens to vault", async () => {
    await program.methods
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

    // Check vault token balance
    const vaultTokenAccountInfo = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );
    expect(Number(vaultTokenAccountInfo.amount)).to.equal(DEPOSIT_AMOUNT);

    // Check authority token balance
    const authorityTokenAccountInfo = await getAccount(
      provider.connection,
      authorityTokenAccount
    );
    expect(Number(authorityTokenAccountInfo.amount)).to.equal(MINT_AMOUNT - DEPOSIT_AMOUNT);
  });

  it("Borrow and distribute tokens (gasless transaction)", async () => {
    // Find borrower account PDA
    [borrowerAccountPda] = await PublicKey.findProgramAddressSync(
      [Buffer.from("borrower"), vaultPda.toBuffer(), borrower.publicKey.toBuffer()],
      program.programId
    );

    // Check initial recipient balances (should be 0)
    const initialBalances = await Promise.all(
      [recipient1TokenAccount, recipient2TokenAccount, recipient3TokenAccount].map(
        async (account) => {
          const info = await getAccount(provider.connection, account);
          return Number(info.amount);
        }
      )
    );
    expect(initialBalances).to.deep.equal([0, 0, 0]);

    // Execute gasless transaction
    await program.methods
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

    // Check recipient balances
    const expectedPerRecipient = BORROW_AMOUNT / 3;
    const finalBalances = await Promise.all(
      [recipient1TokenAccount, recipient2TokenAccount, recipient3TokenAccount].map(
        async (account) => {
          const info = await getAccount(provider.connection, account);
          return Number(info.amount);
        }
      )
    );
    expect(finalBalances).to.deep.equal([
      expectedPerRecipient,
      expectedPerRecipient,
      expectedPerRecipient,
    ]);

    // Check vault balance
    const vaultTokenAccountInfo = await getAccount(
      provider.connection,
      vaultTokenAccount.publicKey
    );
    expect(Number(vaultTokenAccountInfo.amount)).to.equal(DEPOSIT_AMOUNT - BORROW_AMOUNT);

    // Check borrower account state
    const borrowerAccount = await program.account.borrowerAccount.fetch(borrowerAccountPda);
    expect(borrowerAccount.borrower.toString()).to.equal(borrower.publicKey.toString());
    expect(borrowerAccount.vault.toString()).to.equal(vaultPda.toString());
    expect(borrowerAccount.borrowedAmounts.length).to.equal(1);
    expect(borrowerAccount.borrowedAmounts[0].mint.toString()).to.equal(
      mintKeypair.publicKey.toString()
    );
    expect(borrowerAccount.borrowedAmounts[0].amount.toString()).to.equal(
      BORROW_AMOUNT.toString()
    );
  });

  it("Non-whitelisted address cannot borrow tokens", async () => {
    // Create a new non-whitelisted user
    const nonWhitelistedUser = Keypair.generate();
    
    // Airdrop SOL to this user
    const airdropSig = await provider.connection.requestAirdrop(
      nonWhitelistedUser.publicKey,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Find borrower account PDA for this user
    const [nonWhitelistedBorrowerPda] = await PublicKey.findProgramAddressSync(
      [Buffer.from("borrower"), vaultPda.toBuffer(), nonWhitelistedUser.publicKey.toBuffer()],
      program.programId
    );

    // Attempt to borrow and distribute tokens
    try {
      await program.methods
        .borrowAndDistribute(new anchor.BN(BORROW_AMOUNT))
        .accounts({
          borrower: nonWhitelistedUser.publicKey,
          vault: vaultPda,
          whitelist: whitelistPda,
          borrowerAccount: nonWhitelistedBorrowerPda,
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
        .signers([nonWhitelistedUser, feePayer])
        .rpc();
      
      // If we get here, the test failed because the transaction should have failed
      expect.fail("Non-whitelisted user was able to borrow tokens");
    } catch (error) {
      // Expected error
      expect(error.toString()).to.include("NotWhitelisted");
    }
  });

  it("Cannot borrow with invalid amount (not divisible by 3)", async () => {
    const invalidAmount = 100; // Not divisible by 3
    
    try {
      await program.methods
        .borrowAndDistribute(new anchor.BN(invalidAmount))
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
      
      // If we get here, the test failed
      expect.fail("Should not be able to borrow amount not divisible by 3");
    } catch (error) {
      // Expected error
      expect(error.toString()).to.include("InvalidDistributionAmount");
    }
  });

  it("Borrower can borrow additional tokens", async () => {
    // Initial borrowed amount
    const initialBorrowerAccount = await program.account.borrowerAccount.fetch(borrowerAccountPda);
    const initialBorrowedAmount = Number(initialBorrowerAccount.borrowedAmounts[0].amount);
    
    // Borrow more tokens
    const additionalAmount = 30000; // Another amount divisible by 3
    
    await program.methods
      .borrowAndDistribute(new anchor.BN(additionalAmount))
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
    
    // Check updated borrower account
    const updatedBorrowerAccount = await program.account.borrowerAccount.fetch(borrowerAccountPda);
    expect(Number(updatedBorrowerAccount.borrowedAmounts[0].amount)).to.equal(
      initialBorrowedAmount + additionalAmount
    );
    
    // Check recipient balances (each should have received an additional additionalAmount/3)
    const expectedPerRecipient = additionalAmount / 3;
    const expectedTotal = (BORROW_AMOUNT / 3) + expectedPerRecipient;
    
    const finalBalances = await Promise.all(
      [recipient1TokenAccount, recipient2TokenAccount, recipient3TokenAccount].map(
        async (account) => {
          const info = await getAccount(provider.connection, account);
          return Number(info.amount);
        }
      )
    );
    
    expect(finalBalances).to.deep.equal([
      expectedTotal,
      expectedTotal,
      expectedTotal,
    ]);
  });

  it("Remove borrower from whitelist", async () => {
    await program.methods
      .removeFromWhitelist(borrower.publicKey)
      .accounts({
        authority: vaultAuthority.publicKey,
        vault: vaultPda,
        whitelist: whitelistPda,
      })
      .signers([vaultAuthority])
      .rpc();

    // Verify whitelist no longer includes borrower
    const whitelistAccount = await program.account.whitelist.fetch(whitelistPda);
    expect(whitelistAccount.addresses.length).to.equal(0);
    
    // Verify borrower can no longer borrow
    try {
      await program.methods
        .borrowAndDistribute(new anchor.BN(30))
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
      
      // If we get here, the test failed
      expect.fail("Removed borrower should not be able to borrow tokens");
    } catch (error) {
      // Expected error
      expect(error.toString()).to.include("NotWhitelisted");
    }
  });
});