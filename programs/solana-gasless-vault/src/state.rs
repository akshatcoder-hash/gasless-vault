use anchor_lang::prelude::*;

#[account]
pub struct Vault {
    /// The authority who can add/remove from whitelist
    pub authority: Pubkey,
    /// Number of tokens managed by this vault
    pub token_count: u64,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

#[account]
pub struct Whitelist {
    /// Whitelisted addresses allowed to borrow
    pub addresses: Vec<Pubkey>,
    /// The vault this whitelist belongs to
    pub vault: Pubkey,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

#[account]
pub struct TokenVault {
    /// The token mint address
    pub mint: Pubkey,
    /// The token account holding the tokens
    pub token_account: Pubkey,
    /// The main vault this token vault belongs to
    pub vault: Pubkey,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

#[account]
pub struct BorrowerAccount {
    /// The borrower's address
    pub borrower: Pubkey,
    /// Mapping of mint address to borrowed amount
    pub borrowed_amounts: Vec<BorrowRecord>,
    /// The vault this borrower account belongs to
    pub vault: Pubkey,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

/// Record of tokens borrowed by a user
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct BorrowRecord {
    /// Token mint address
    pub mint: Pubkey,
    /// Amount borrowed
    pub amount: u64,
}