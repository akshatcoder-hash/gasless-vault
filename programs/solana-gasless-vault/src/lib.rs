use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

mod errors;
mod instructions;
mod state;

use errors::VaultError;
use instructions::*;
use state::*;

declare_id!("Doy7k9b5ALUjbAiY9rQzXxcQ89N1QmEhBdbX5yuBQ9bj");

#[program]
pub mod solana_gasless_vault {
    use super::*;

    /// Initialize a new vault
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.token_count = 0;
        vault.bump = ctx.bumps.vault;

        let whitelist = &mut ctx.accounts.whitelist;
        whitelist.addresses = Vec::new();
        whitelist.vault = vault.key();
        whitelist.bump = ctx.bumps.whitelist;

        msg!("Vault initialized!");
        Ok(())
    }

    /// Add an address to the whitelist
    pub fn add_to_whitelist(ctx: Context<AddToWhitelist>, address: Pubkey) -> Result<()> {
        let whitelist = &mut ctx.accounts.whitelist;

        // Avoid duplicates
        if !whitelist.addresses.contains(&address) {
            whitelist.addresses.push(address);
            msg!("Address added to whitelist: {}", address);
        } else {
            msg!("Address already in whitelist: {}", address);
        }

        Ok(())
    }

    /// Remove an address from the whitelist
    pub fn remove_from_whitelist(ctx: Context<RemoveFromWhitelist>, address: Pubkey) -> Result<()> {
        let whitelist = &mut ctx.accounts.whitelist;

        let position = whitelist.addresses.iter().position(|&x| x == address);

        if let Some(index) = position {
            whitelist.addresses.remove(index);
            msg!("Address removed from whitelist: {}", address);
        } else {
            msg!("Address not found in whitelist: {}", address);
        }

        Ok(())
    }

    /// Add a token to the vault
    pub fn add_token(ctx: Context<AddToken>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let token_vault = &mut ctx.accounts.token_vault;

        // Set token_vault data
        token_vault.mint = ctx.accounts.mint.key();
        token_vault.token_account = ctx.accounts.token_account.key();
        token_vault.vault = vault.key();
        token_vault.bump = ctx.bumps.token_vault;

        // Increment token count
        vault.token_count = vault
            .token_count
            .checked_add(1)
            .ok_or(VaultError::MathOverflow)?;

        msg!("Token added to vault: {}", ctx.accounts.mint.key());
        Ok(())
    }

    /// Deposit tokens to the vault
    pub fn deposit_tokens(ctx: Context<DepositTokens>, amount: u64) -> Result<()> {
        // Verify amount
        if amount == 0 {
            return Err(VaultError::InvalidAmount.into());
        }

        // Transfer tokens from depositor to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::transfer(cpi_ctx, amount)?;

        msg!("Deposited {} tokens to vault", amount);
        Ok(())
    }

    /// Borrow tokens from the vault and distribute them equally to 3 recipients
    pub fn borrow_and_distribute(ctx: Context<BorrowAndDistribute>, amount: u64) -> Result<()> {
        // Verify amount
        if amount == 0 {
            return Err(VaultError::InvalidAmount.into());
        }

        // Amount must be divisible by 3 for equal distribution
        if amount % 3 != 0 {
            return Err(VaultError::InvalidDistributionAmount.into());
        }

        let per_recipient_amount = amount / 3;

        // Check if vault has enough tokens
        if ctx.accounts.vault_token_account.amount < amount {
            return Err(VaultError::InsufficientFunds.into());
        }

        // Update borrower records
        let borrower_account = &mut ctx.accounts.borrower_account;

        // Initialize if new
        if borrower_account.borrowed_amounts.is_empty() {
            borrower_account.borrower = ctx.accounts.borrower.key();
            borrower_account.vault = ctx.accounts.vault.key();
            borrower_account.bump = ctx.bumps.borrower_account;
        }

        // Update or add borrow record
        let mint_key = ctx.accounts.mint.key();
        let position = borrower_account
            .borrowed_amounts
            .iter()
            .position(|x| x.mint == mint_key);

        match position {
            Some(index) => {
                let new_amount = borrower_account.borrowed_amounts[index]
                    .amount
                    .checked_add(amount)
                    .ok_or(VaultError::MathOverflow)?;
                borrower_account.borrowed_amounts[index].amount = new_amount;
            }
            None => {
                borrower_account.borrowed_amounts.push(BorrowRecord {
                    mint: mint_key,
                    amount,
                });
            }
        }

        // Create PDA signer for token vault
        let token_vault_key = ctx.accounts.token_vault.key();
        let seeds = &[
            b"token_vault",
            ctx.accounts.vault.to_account_info().key.as_ref(),
            ctx.accounts.mint.to_account_info().key.as_ref(),
            &[ctx.accounts.token_vault.bump],
        ];
        let signer = &[&seeds[..]];

        // Transfer to first recipient
        {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.recipient_token_account_1.to_account_info(),
                authority: ctx.accounts.token_vault.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
            token::transfer(cpi_ctx, per_recipient_amount)?;
        }

        // Transfer to second recipient
        {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.recipient_token_account_2.to_account_info(),
                authority: ctx.accounts.token_vault.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
            token::transfer(cpi_ctx, per_recipient_amount)?;
        }

        // Transfer to third recipient
        {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.recipient_token_account_3.to_account_info(),
                authority: ctx.accounts.token_vault.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
            token::transfer(cpi_ctx, per_recipient_amount)?;
        }

        msg!(
            "Borrowed and distributed {} tokens ({} to each recipient)",
            amount,
            per_recipient_amount
        );
        Ok(())
    }
}
