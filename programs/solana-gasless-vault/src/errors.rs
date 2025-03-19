use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Unauthorized access")]
    Unauthorized,
    
    #[msg("Invalid token account")]
    InvalidTokenAccount,
    
    #[msg("Address not whitelisted")]
    NotWhitelisted,
    
    #[msg("Insufficient funds in vault")]
    InsufficientFunds,
    
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    
    #[msg("Math overflow")]
    MathOverflow,
    
    #[msg("Invalid recipient")]
    InvalidRecipient,
    
    #[msg("Distribution amount must be divisible by 3")]
    InvalidDistributionAmount,
}