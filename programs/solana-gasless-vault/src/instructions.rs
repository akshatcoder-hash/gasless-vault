use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use crate::state::*;
use crate::errors::VaultError;
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 8 + 1,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 4 + (32 * 50) + 1, // Support up to 50 addresses initially
        seeds = [b"whitelist", vault.key().as_ref()],
        bump
    )]
    pub whitelist: Account<'info, Whitelist>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddToWhitelist<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        constraint = vault.authority == authority.key() @ VaultError::Unauthorized
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [b"whitelist", vault.key().as_ref()],
        bump = whitelist.bump
    )]
    pub whitelist: Account<'info, Whitelist>,
}

#[derive(Accounts)]
pub struct RemoveFromWhitelist<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        constraint = vault.authority == authority.key() @ VaultError::Unauthorized
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds = [b"whitelist", vault.key().as_ref()],
        bump = whitelist.bump
    )]
    pub whitelist: Account<'info, Whitelist>,
}

#[derive(Accounts)]
pub struct AddToken<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = vault.authority == authority.key() @ VaultError::Unauthorized
    )]
    pub vault: Account<'info, Vault>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 32 + 1,
        seeds = [b"token_vault", vault.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub token_vault: Account<'info, TokenVault>,

    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = token_vault,
    )]
    pub token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositTokens<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [b"vault"],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub mint: Account<'info, Mint>,

    #[account(
        seeds = [b"token_vault", vault.key().as_ref(), mint.key().as_ref()],
        bump = token_vault.bump,
        constraint = token_vault.mint == mint.key() @ VaultError::InvalidTokenAccount
    )]
    pub token_vault: Account<'info, TokenVault>,

    #[account(
        mut,
        constraint = vault_token_account.mint == mint.key() @ VaultError::InvalidTokenAccount,
        constraint = vault_token_account.owner == token_vault.key() @ VaultError::InvalidTokenAccount
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = depositor_token_account.mint == mint.key() @ VaultError::InvalidTokenAccount,
        constraint = depositor_token_account.owner == depositor.key() @ VaultError::InvalidTokenAccount
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BorrowAndDistribute<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        seeds = [b"vault"],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        seeds = [b"whitelist", vault.key().as_ref()],
        bump = whitelist.bump,
        constraint = whitelist.addresses.contains(&borrower.key()) @ VaultError::NotWhitelisted
    )]
    pub whitelist: Account<'info, Whitelist>,

    #[account(
        init_if_needed,
        payer = fee_payer,
        space = 8 + 32 + 4 + (64 * 10) + 32 + 1, // Support up to 10 different tokens
        seeds = [b"borrower", vault.key().as_ref(), borrower.key().as_ref()],
        bump
    )]
    pub borrower_account: Account<'info, BorrowerAccount>,

    pub mint: Account<'info, Mint>,

    #[account(
        seeds = [b"token_vault", vault.key().as_ref(), mint.key().as_ref()],
        bump = token_vault.bump,
        constraint = token_vault.mint == mint.key() @ VaultError::InvalidTokenAccount
    )]
    pub token_vault: Account<'info, TokenVault>,

    #[account(
        mut,
        constraint = vault_token_account.mint == mint.key() @ VaultError::InvalidTokenAccount,
        constraint = vault_token_account.owner == token_vault.key() @ VaultError::InvalidTokenAccount
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// First recipient token account
    #[account(
        mut,
        constraint = recipient_token_account_1.mint == mint.key() @ VaultError::InvalidTokenAccount
    )]
    pub recipient_token_account_1: Account<'info, TokenAccount>,

    /// Second recipient token account
    #[account(
        mut,
        constraint = recipient_token_account_2.mint == mint.key() @ VaultError::InvalidTokenAccount
    )]
    pub recipient_token_account_2: Account<'info, TokenAccount>,

    /// Third recipient token account
    #[account(
        mut,
        constraint = recipient_token_account_3.mint == mint.key() @ VaultError::InvalidTokenAccount
    )]
    pub recipient_token_account_3: Account<'info, TokenAccount>,

    /// Fee payer for the transaction (3rd party)
    #[account(mut)]
    pub fee_payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}