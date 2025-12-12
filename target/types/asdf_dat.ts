/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/asdf_dat.json`.
 */
export type AsdfDat = {
  "address": "ASDFc5hkEM2MF8mrAAtCPieV6x6h1B5BwjgztFt7Xbui",
  "metadata": {
    "name": "asdfDat",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "ASDF DAT"
  },
  "instructions": [
    {
      "name": "acceptAdminTransfer",
      "docs": [
        "Accept admin transfer (must be called by the proposed admin)"
      ],
      "discriminator": [
        89,
        211,
        96,
        212,
        233,
        0,
        251,
        7
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "newAdmin",
          "docs": [
            "The proposed admin who is accepting the transfer"
          ],
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "burnAndUpdate",
      "discriminator": [
        56,
        128,
        113,
        77,
        16,
        192,
        209,
        118
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "tokenStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "asdfMint"
              }
            ]
          }
        },
        {
          "name": "datAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAsdfAccount",
          "writable": true
        },
        {
          "name": "asdfMint",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "cancelAdminTransfer",
      "docs": [
        "Cancel a pending admin transfer (called by current admin)"
      ],
      "discriminator": [
        38,
        131,
        157,
        31,
        240,
        137,
        44,
        215
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "collectFees",
      "discriminator": [
        164,
        152,
        207,
        99,
        30,
        186,
        19,
        182
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "tokenStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "datAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "creatorVault",
          "docs": [
            "Seeds: [\"creator-vault\", creator_pubkey] where creator=dat_authority.",
            "The CPI to collect_creator_fee will fail if this is not a valid vault.",
            "NOTE: Vault is a native SOL account (System Program owner), NOT owned by PUMP_PROGRAM."
          ],
          "writable": true
        },
        {
          "name": "pumpEventAuthority"
        },
        {
          "name": "pumpSwapProgram"
        },
        {
          "name": "rootTreasury",
          "docs": [
            "via PDA derivation: [\"root_treasury\", root_token_mint]"
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "isRootToken",
          "type": "bool"
        },
        {
          "name": "forEcosystem",
          "type": "bool"
        }
      ]
    },
    {
      "name": "collectFeesAmm",
      "docs": [
        "Collect fees from PumpSwap AMM creator vault",
        "Used for tokens that have migrated from bonding curve to AMM",
        "Requires: DAT authority PDA must be set as coin_creator in PumpSwap",
        "IMPORTANT: This collects WSOL (SPL Token), not native SOL"
      ],
      "discriminator": [
        89,
        152,
        80,
        30,
        130,
        141,
        42,
        65
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "tokenStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "datAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "wsolMint",
          "docs": [
            "WSOL mint (So11111111111111111111111111111111111111112)"
          ]
        },
        {
          "name": "datWsolAccount",
          "docs": [
            "DAT's WSOL token account (destination for collected fees)"
          ],
          "writable": true
        },
        {
          "name": "creatorVaultAuthority"
        },
        {
          "name": "creatorVaultAta",
          "writable": true
        },
        {
          "name": "pumpSwapProgram"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "createPumpfunTokenMayhem",
      "docs": [
        "Create a PumpFun token in Mayhem Mode with AI trading agent",
        "Uses Token2022 and create_v2 instruction",
        "Supply: 2 billion tokens (1B + 1B for agent)"
      ],
      "discriminator": [
        110,
        227,
        18,
        24,
        157,
        240,
        50,
        90
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint",
          "writable": true,
          "signer": true
        },
        {
          "name": "mintAuthority"
        },
        {
          "name": "bondingCurve",
          "writable": true
        },
        {
          "name": "associatedBondingCurve",
          "writable": true
        },
        {
          "name": "global"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "token2022Program"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "mayhemProgram",
          "writable": true
        },
        {
          "name": "globalParams"
        },
        {
          "name": "solVault",
          "writable": true
        },
        {
          "name": "mayhemState",
          "writable": true
        },
        {
          "name": "mayhemTokenVault",
          "writable": true
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "pumpProgram"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "createPumpfunTokenV2",
      "docs": [
        "Create a PumpFun token using create_v2 (Token2022) without Mayhem Mode",
        "Standard Token2022 token with 1B supply"
      ],
      "discriminator": [
        236,
        163,
        184,
        147,
        15,
        105,
        148,
        252
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint",
          "writable": true,
          "signer": true
        },
        {
          "name": "mintAuthority"
        },
        {
          "name": "bondingCurve",
          "writable": true
        },
        {
          "name": "associatedBondingCurve",
          "writable": true
        },
        {
          "name": "global"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "token2022Program"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "pumpProgram"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "depositFeeAsdf",
      "docs": [
        "External app deposits $ASDF fees with automatic split",
        "Split: 99.448% → DAT ATA (burn), 0.552% → Rebate Pool ATA (rebates)",
        "",
        "Architecture:",
        "- Payer transfers full amount",
        "- 99.448% goes to DAT ATA (included in ROOT cycle single burn)",
        "- 0.552% goes to Rebate Pool ATA (self-sustaining fund)",
        "- UserStats.pending_contribution tracks full amount for rebate calculation"
      ],
      "discriminator": [
        46,
        188,
        111,
        45,
        29,
        66,
        46,
        65
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "rebatePool",
          "docs": [
            "Rebate pool state (for tracking deposits)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  98,
                  97,
                  116,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "userStats",
          "docs": [
            "User stats - initialized if needed",
            "Protocol pays rent via dat_authority"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user",
          "docs": [
            "The user whose contribution is being tracked"
          ]
        },
        {
          "name": "payerTokenAccount",
          "docs": [
            "Payer's $ASDF token account (source of deposit)"
          ],
          "writable": true
        },
        {
          "name": "datAsdfAccount",
          "docs": [
            "DAT's $ASDF token account (receives 99.448% for burn)"
          ],
          "writable": true
        },
        {
          "name": "rebatePoolAta",
          "docs": [
            "Rebate pool's $ASDF ATA (receives 0.552% for rebates)"
          ],
          "writable": true
        },
        {
          "name": "payer",
          "docs": [
            "Transaction payer (can be builder or protocol)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "emergencyPause",
      "discriminator": [
        21,
        143,
        27,
        142,
        200,
        181,
        210,
        255
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "executeBuy",
      "docs": [
        "Execute buy on bonding curve - ROOT TOKEN ONLY (simpler, no split logic)",
        "For secondary tokens, use execute_buy_secondary instead"
      ],
      "discriminator": [
        14,
        137,
        248,
        5,
        172,
        244,
        183,
        152
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAsdfAccount",
          "docs": [
            "DAT's token account for receiving bought tokens - validated mint and authority"
          ],
          "writable": true
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "asdfMint",
          "writable": true
        },
        {
          "name": "poolAsdfAccount",
          "writable": true
        },
        {
          "name": "pumpGlobalConfig"
        },
        {
          "name": "protocolFeeRecipient",
          "writable": true
        },
        {
          "name": "creatorVault",
          "writable": true
        },
        {
          "name": "pumpEventAuthority"
        },
        {
          "name": "pumpSwapProgram"
        },
        {
          "name": "globalVolumeAccumulator"
        },
        {
          "name": "userVolumeAccumulator",
          "writable": true
        },
        {
          "name": "feeConfig"
        },
        {
          "name": "feeProgram"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "allocatedLamports",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "executeBuyAmm",
      "docs": [
        "Execute buy on PumpSwap AMM pool (for migrated tokens)",
        "This instruction handles tokens that have graduated from bonding curve to AMM",
        "Requires WSOL in dat_wsol_account for the buy operation",
        "",
        "MEDIUM-01 FIX: Added slippage validation to ensure received tokens meet minimum threshold"
      ],
      "discriminator": [
        239,
        72,
        220,
        75,
        250,
        12,
        58,
        221
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datTokenAccount",
          "docs": [
            "DAT's token account for receiving bought tokens - validated mint and authority"
          ],
          "writable": true
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "globalConfig"
        },
        {
          "name": "baseMint",
          "docs": [
            "Base token mint (the token being bought)"
          ]
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "datWsolAccount",
          "writable": true
        },
        {
          "name": "poolBaseTokenAccount",
          "writable": true
        },
        {
          "name": "poolQuoteTokenAccount",
          "writable": true
        },
        {
          "name": "protocolFeeRecipient"
        },
        {
          "name": "protocolFeeRecipientAta",
          "writable": true
        },
        {
          "name": "baseTokenProgram",
          "docs": [
            "Base token program (SPL Token or Token2022)"
          ]
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "eventAuthority"
        },
        {
          "name": "pumpSwapProgram"
        },
        {
          "name": "coinCreatorVaultAta",
          "writable": true
        },
        {
          "name": "coinCreatorVaultAuthority"
        },
        {
          "name": "globalVolumeAccumulator"
        },
        {
          "name": "userVolumeAccumulator",
          "writable": true
        },
        {
          "name": "feeConfig"
        },
        {
          "name": "feeProgram"
        }
      ],
      "args": [
        {
          "name": "desiredTokens",
          "type": "u64"
        },
        {
          "name": "maxSolCost",
          "type": "u64"
        }
      ]
    },
    {
      "name": "executeBuySecondary",
      "docs": [
        "Execute buy for SECONDARY tokens (includes fee split to root treasury)"
      ],
      "discriminator": [
        4,
        51,
        212,
        248,
        213,
        148,
        13,
        205
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAsdfAccount",
          "docs": [
            "DAT's token account - validated mint and authority"
          ],
          "writable": true
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "asdfMint",
          "writable": true
        },
        {
          "name": "poolAsdfAccount",
          "docs": [
            "Pool's token account - validated mint matches"
          ],
          "writable": true
        },
        {
          "name": "pumpGlobalConfig"
        },
        {
          "name": "protocolFeeRecipient",
          "writable": true
        },
        {
          "name": "creatorVault",
          "writable": true
        },
        {
          "name": "pumpEventAuthority"
        },
        {
          "name": "pumpSwapProgram"
        },
        {
          "name": "globalVolumeAccumulator"
        },
        {
          "name": "userVolumeAccumulator",
          "writable": true
        },
        {
          "name": "feeConfig"
        },
        {
          "name": "feeProgram"
        },
        {
          "name": "rootTreasury",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "allocatedLamports",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "executeFeeSplit",
      "docs": [
        "Execute a pending fee split change (after cooldown period)"
      ],
      "discriminator": [
        205,
        104,
        254,
        72,
        93,
        230,
        0,
        191
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "newAdmin"
        }
      ],
      "args": []
    },
    {
      "name": "finalizeAllocatedCycle",
      "discriminator": [
        153,
        68,
        114,
        53,
        231,
        193,
        206,
        43
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "tokenStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "token_stats.mint",
                "account": "tokenStats"
              }
            ]
          }
        },
        {
          "name": "admin",
          "docs": [
            "Admin signer required - only admin can finalize allocated cycles"
          ],
          "signer": true
        }
      ],
      "args": [
        {
          "name": "actuallyParticipated",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeRebatePool",
      "docs": [
        "Initialize the self-sustaining rebate pool",
        "Called once during protocol setup"
      ],
      "discriminator": [
        111,
        130,
        48,
        237,
        239,
        39,
        126,
        173
      ],
      "accounts": [
        {
          "name": "rebatePool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  98,
                  97,
                  116,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "docs": [
            "Admin must authorize initialization"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeTokenStats",
      "discriminator": [
        234,
        129,
        212,
        97,
        174,
        172,
        212,
        102
      ],
      "accounts": [
        {
          "name": "tokenStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeValidator",
      "docs": [
        "Initialize validator state for trustless per-token fee tracking",
        "Must be called once per token before register_validated_fees can be used"
      ],
      "discriminator": [
        1,
        208,
        135,
        238,
        15,
        185,
        20,
        172
      ],
      "accounts": [
        {
          "name": "validatorState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  111,
                  114,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "bondingCurve"
        },
        {
          "name": "mint"
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "migrateTokenStats",
      "discriminator": [
        79,
        11,
        103,
        60,
        105,
        128,
        13,
        202
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "tokenStats",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "processUserRebate",
      "docs": [
        "Process user rebate - transfer from pool to selected user",
        "Called as LAST instruction in ROOT cycle batch",
        "",
        "NOTE: This instruction does NOT burn. The burn happens in the single",
        "ROOT cycle burn instruction which includes all DAT ATA balance",
        "(buyback + user deposits 99.448%).",
        "",
        "This instruction only:",
        "1. Validates user eligibility (pending >= threshold)",
        "2. Calculates rebate amount (0.552% of pending)",
        "3. Transfers rebate from pool → user ATA",
        "4. Resets pending and updates stats"
      ],
      "discriminator": [
        134,
        186,
        58,
        80,
        169,
        72,
        254,
        185
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "rebatePool",
          "docs": [
            "Rebate pool authority PDA"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  98,
                  97,
                  116,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "rebatePoolAta",
          "docs": [
            "Rebate pool's $ASDF ATA (source of rebate funds)"
          ],
          "writable": true
        },
        {
          "name": "userStats",
          "docs": [
            "Selected user's stats"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "user"
        },
        {
          "name": "userAta",
          "docs": [
            "User's $ASDF ATA (destination for rebate)"
          ],
          "writable": true
        },
        {
          "name": "admin",
          "docs": [
            "Admin authorization for rebate processing"
          ],
          "signer": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "proposeAdminTransfer",
      "docs": [
        "Propose a new admin (two-step transfer for security)"
      ],
      "discriminator": [
        218,
        178,
        115,
        190,
        80,
        107,
        95,
        158
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "newAdmin"
        }
      ],
      "args": []
    },
    {
      "name": "proposeFeeSplit",
      "docs": [
        "Propose a fee split change (subject to timelock)"
      ],
      "discriminator": [
        232,
        194,
        55,
        204,
        149,
        144,
        177,
        146
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "newAdmin"
        }
      ],
      "args": [
        {
          "name": "newFeeSplitBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "recordFailure",
      "discriminator": [
        86,
        94,
        231,
        2,
        95,
        43,
        53,
        161
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "docs": [
            "Admin signer required to prevent DoS attacks"
          ],
          "signer": true
        }
      ],
      "args": [
        {
          "name": "errorCode",
          "type": "u32"
        }
      ]
    },
    {
      "name": "registerValidatedFees",
      "docs": [
        "ADMIN ONLY - Register validated fees extracted from PumpFun transaction logs",
        "Only admin can call this to commit validated fee data",
        "",
        "Security: Protected by admin check, slot progression, and fee caps"
      ],
      "discriminator": [
        47,
        27,
        53,
        254,
        49,
        113,
        142,
        101
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "docs": [
            "Admin signer - only admin can register fees (CRITICAL security fix)"
          ],
          "signer": true
        },
        {
          "name": "validatorState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  111,
                  114,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "validator_state.mint",
                "account": "validatorState"
              }
            ]
          }
        },
        {
          "name": "tokenStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "validator_state.mint",
                "account": "validatorState"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "feeAmount",
          "type": "u64"
        },
        {
          "name": "endSlot",
          "type": "u64"
        },
        {
          "name": "txCount",
          "type": "u32"
        }
      ]
    },
    {
      "name": "resetValidatorSlot",
      "docs": [
        "ADMIN ONLY - Reset validator slot to current slot",
        "Used when validator has been inactive for too long (slot delta > 1000)",
        "This allows the validator daemon to resume operation without redeploying"
      ],
      "discriminator": [
        248,
        5,
        115,
        210,
        236,
        36,
        129,
        62
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "validatorState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  111,
                  114,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "validator_state.mint",
                "account": "validatorState"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "resume",
      "discriminator": [
        1,
        166,
        51,
        170,
        127,
        32,
        141,
        206
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "setRootToken",
      "discriminator": [
        63,
        87,
        166,
        213,
        186,
        169,
        225,
        81
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "rootTokenStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "root_token_stats.mint",
                "account": "tokenStats"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "rootMint",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "syncValidatorSlot",
      "docs": [
        "Sync validator slot to current slot (permissionless)",
        "",
        "This instruction allows anyone to reset the last_validated_slot to the current slot",
        "when the validator state has become stale (> MAX_SLOT_RANGE behind current slot).",
        "This is useful after periods of inactivity to allow the daemon to resume operation.",
        "",
        "Note: This does NOT affect fee attribution - it simply allows new validations to proceed.",
        "Any fees from the skipped slots are lost (this is acceptable for inactivity periods)."
      ],
      "discriminator": [
        232,
        176,
        142,
        149,
        203,
        18,
        131,
        250
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "validatorState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  108,
                  105,
                  100,
                  97,
                  116,
                  111,
                  114,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "validator_state.mint",
                "account": "validatorState"
              }
            ]
          }
        },
        {
          "name": "admin",
          "docs": [
            "Admin authority - HIGH-02 FIX: Required to prevent DoS"
          ],
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "transferAdmin",
      "docs": [
        "DEPRECATED: Use propose_admin_transfer + accept_admin_transfer instead",
        "Kept for backwards compatibility - now just proposes the transfer"
      ],
      "discriminator": [
        42,
        242,
        66,
        106,
        228,
        10,
        111,
        156
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "newAdmin"
        }
      ],
      "args": []
    },
    {
      "name": "transferDevFee",
      "docs": [
        "Transfer 1% dev sustainability fee",
        "Called at the end of each batch transaction, after burn succeeds",
        "1% today = 99% burns forever"
      ],
      "discriminator": [
        50,
        51,
        38,
        67,
        231,
        227,
        103,
        235
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "devWallet",
          "docs": [
            "1% today = 99% burns forever"
          ],
          "writable": true,
          "address": "dcW5uy7wKdKFxkhyBfPv3MyvrCkDcv1rWucoat13KH4"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "secondaryShare",
          "type": "u64"
        }
      ]
    },
    {
      "name": "unwrapWsol",
      "docs": [
        "Unwrap WSOL to native SOL in DAT authority account",
        "Call this after collect_fees_amm to convert WSOL to SOL for buyback"
      ],
      "discriminator": [
        4,
        6,
        123,
        139,
        46,
        174,
        17,
        154
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datWsolAccount",
          "docs": [
            "DAT's WSOL token account (will be closed)"
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "updateFeeSplit",
      "discriminator": [
        120,
        149,
        67,
        33,
        63,
        94,
        168,
        245
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newFeeSplitBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "updateParameters",
      "discriminator": [
        116,
        107,
        24,
        207,
        101,
        49,
        213,
        77
      ],
      "accounts": [
        {
          "name": "datState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newMinFees",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "newMaxFees",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "newSlippageBps",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "newMinInterval",
          "type": {
            "option": "i64"
          }
        }
      ]
    },
    {
      "name": "updatePendingFees",
      "discriminator": [
        26,
        208,
        168,
        145,
        149,
        206,
        83,
        42
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "tokenStats",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  115,
                  116,
                  97,
                  116,
                  115,
                  95,
                  118,
                  49
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "admin",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "amountLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "wrapWsol",
      "docs": [
        "Wrap native SOL to WSOL for AMM buyback",
        "Call this before execute_buy_amm when root token is on PumpSwap AMM",
        "The dat_wsol_account must already exist (created by caller)"
      ],
      "discriminator": [
        24,
        173,
        95,
        186,
        149,
        56,
        111,
        78
      ],
      "accounts": [
        {
          "name": "datState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datAuthority",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  95,
                  118,
                  51
                ]
              }
            ]
          }
        },
        {
          "name": "datWsolAccount",
          "docs": [
            "DAT's WSOL token account (destination for wrapped SOL)",
            "Must be owned by dat_authority and have WSOL mint"
          ],
          "writable": true
        },
        {
          "name": "wsolMint",
          "docs": [
            "WSOL mint (So11111111111111111111111111111111111111112)"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "datState",
      "discriminator": [
        196,
        195,
        136,
        62,
        68,
        91,
        102,
        182
      ]
    },
    {
      "name": "rebatePool",
      "discriminator": [
        111,
        211,
        11,
        147,
        116,
        127,
        107,
        35
      ]
    },
    {
      "name": "tokenStats",
      "discriminator": [
        7,
        126,
        25,
        232,
        73,
        79,
        202,
        236
      ]
    },
    {
      "name": "userStats",
      "discriminator": [
        176,
        223,
        136,
        27,
        122,
        79,
        32,
        227
      ]
    },
    {
      "name": "validatorState",
      "discriminator": [
        217,
        140,
        124,
        163,
        31,
        187,
        1,
        89
      ]
    }
  ],
  "events": [
    {
      "name": "adminTransferCancelled",
      "discriminator": [
        93,
        23,
        69,
        55,
        216,
        128,
        106,
        56
      ]
    },
    {
      "name": "adminTransferProposed",
      "discriminator": [
        203,
        168,
        175,
        51,
        239,
        104,
        20,
        85
      ]
    },
    {
      "name": "adminTransferred",
      "discriminator": [
        255,
        147,
        182,
        5,
        199,
        217,
        38,
        179
      ]
    },
    {
      "name": "ammFeesCollected",
      "discriminator": [
        52,
        168,
        200,
        204,
        254,
        238,
        245,
        191
      ]
    },
    {
      "name": "asdfMintUpdated",
      "discriminator": [
        167,
        181,
        14,
        29,
        112,
        208,
        150,
        125
      ]
    },
    {
      "name": "buyExecuted",
      "discriminator": [
        183,
        7,
        73,
        208,
        153,
        81,
        148,
        198
      ]
    },
    {
      "name": "cycleCompleted",
      "discriminator": [
        189,
        109,
        239,
        146,
        232,
        224,
        55,
        99
      ]
    },
    {
      "name": "cycleFailed",
      "discriminator": [
        23,
        179,
        8,
        23,
        109,
        110,
        91,
        41
      ]
    },
    {
      "name": "datInitialized",
      "discriminator": [
        139,
        90,
        100,
        153,
        60,
        38,
        24,
        107
      ]
    },
    {
      "name": "emergencyAction",
      "discriminator": [
        39,
        136,
        106,
        150,
        85,
        114,
        170,
        156
      ]
    },
    {
      "name": "feeAsdfDeposited",
      "discriminator": [
        134,
        114,
        111,
        126,
        181,
        127,
        78,
        87
      ]
    },
    {
      "name": "feeSplitUpdated",
      "discriminator": [
        125,
        91,
        141,
        252,
        205,
        113,
        171,
        92
      ]
    },
    {
      "name": "feesRedirectedToRoot",
      "discriminator": [
        202,
        59,
        96,
        104,
        217,
        13,
        63,
        130
      ]
    },
    {
      "name": "pendingFeesUpdated",
      "discriminator": [
        119,
        148,
        105,
        59,
        66,
        52,
        54,
        125
      ]
    },
    {
      "name": "rebatePoolInitialized",
      "discriminator": [
        102,
        97,
        217,
        218,
        41,
        0,
        198,
        109
      ]
    },
    {
      "name": "rootTokenSet",
      "discriminator": [
        151,
        90,
        80,
        93,
        136,
        75,
        17,
        40
      ]
    },
    {
      "name": "rootTreasuryCollected",
      "discriminator": [
        150,
        22,
        115,
        246,
        101,
        146,
        102,
        160
      ]
    },
    {
      "name": "statusChanged",
      "discriminator": [
        146,
        235,
        222,
        125,
        145,
        246,
        34,
        240
      ]
    },
    {
      "name": "tokenCreated",
      "discriminator": [
        236,
        19,
        41,
        255,
        130,
        78,
        147,
        172
      ]
    },
    {
      "name": "tokenStatsInitialized",
      "discriminator": [
        200,
        96,
        96,
        41,
        186,
        163,
        165,
        233
      ]
    },
    {
      "name": "userRebateProcessed",
      "discriminator": [
        24,
        144,
        32,
        83,
        183,
        13,
        190,
        77
      ]
    },
    {
      "name": "userStatsInitialized",
      "discriminator": [
        225,
        137,
        106,
        139,
        37,
        103,
        119,
        126
      ]
    },
    {
      "name": "validatedFeesRegistered",
      "discriminator": [
        34,
        96,
        18,
        102,
        182,
        197,
        131,
        53
      ]
    },
    {
      "name": "validatorInitialized",
      "discriminator": [
        196,
        120,
        107,
        225,
        211,
        189,
        89,
        226
      ]
    },
    {
      "name": "validatorSlotReset",
      "discriminator": [
        134,
        36,
        141,
        149,
        129,
        175,
        252,
        175
      ]
    },
    {
      "name": "validatorSlotSynced",
      "discriminator": [
        238,
        149,
        41,
        188,
        11,
        169,
        226,
        133
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "datNotActive",
      "msg": "Protocol paused"
    },
    {
      "code": 6001,
      "name": "insufficientFees",
      "msg": "Below flush threshold - accumulating"
    },
    {
      "code": 6002,
      "name": "unauthorizedAccess",
      "msg": "unauthorized"
    },
    {
      "code": 6003,
      "name": "cycleTooSoon",
      "msg": "Flush interval not elapsed"
    },
    {
      "code": 6004,
      "name": "invalidParameter",
      "msg": "Invalid parameter"
    },
    {
      "code": 6005,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6006,
      "name": "slippageExceeded",
      "msg": "Slippage exceeded - price moved unfavorably"
    },
    {
      "code": 6007,
      "name": "priceImpactTooHigh",
      "msg": "Price impact exceeds safe threshold"
    },
    {
      "code": 6008,
      "name": "vaultNotInitialized",
      "msg": "Vault not initialized - execute a trade first"
    },
    {
      "code": 6009,
      "name": "noPendingBurn",
      "msg": "No tokens pending burn"
    },
    {
      "code": 6010,
      "name": "invalidPool",
      "msg": "Invalid pool state"
    },
    {
      "code": 6011,
      "name": "invalidRootToken",
      "msg": "Invalid root token configuration"
    },
    {
      "code": 6012,
      "name": "invalidRootTreasury",
      "msg": "Invalid root treasury"
    },
    {
      "code": 6013,
      "name": "invalidFeeSplit",
      "msg": "Fee split must be 0-10000 bps"
    },
    {
      "code": 6014,
      "name": "feeSplitDeltaTooLarge",
      "msg": "Fee split delta exceeds 5% maximum"
    },
    {
      "code": 6015,
      "name": "insufficientPoolLiquidity",
      "msg": "Insufficient pool liquidity"
    },
    {
      "code": 6016,
      "name": "staleValidation",
      "msg": "Slot already processed"
    },
    {
      "code": 6017,
      "name": "slotRangeTooLarge",
      "msg": "Slot range exceeds maximum"
    },
    {
      "code": 6018,
      "name": "validatorNotStale",
      "msg": "Validator current - sync not needed"
    },
    {
      "code": 6019,
      "name": "feeTooHigh",
      "msg": "Fee amount exceeds range maximum"
    },
    {
      "code": 6020,
      "name": "tooManyTransactions",
      "msg": "Transaction count exceeds range maximum"
    },
    {
      "code": 6021,
      "name": "invalidBondingCurve",
      "msg": "Invalid bonding curve"
    },
    {
      "code": 6022,
      "name": "mintMismatch",
      "msg": "Mint mismatch"
    },
    {
      "code": 6023,
      "name": "pendingFeesOverflow",
      "msg": "Pending fees at maximum capacity"
    },
    {
      "code": 6024,
      "name": "noPendingAdminTransfer",
      "msg": "No pending admin transfer"
    },
    {
      "code": 6025,
      "name": "noPendingFeeSplit",
      "msg": "No pending fee split change"
    },
    {
      "code": 6026,
      "name": "invalidAccountOwner",
      "msg": "Invalid account owner"
    },
    {
      "code": 6027,
      "name": "slippageConfigTooHigh",
      "msg": "Slippage exceeds 5% maximum"
    },
    {
      "code": 6028,
      "name": "accountSizeMismatch",
      "msg": "Account size mismatch"
    },
    {
      "code": 6029,
      "name": "invalidDevWallet",
      "msg": "Invalid dev wallet address"
    },
    {
      "code": 6030,
      "name": "depositBelowMinimum",
      "msg": "Deposit below minimum threshold"
    },
    {
      "code": 6031,
      "name": "belowRebateThreshold",
      "msg": "User pending contribution below rebate threshold"
    },
    {
      "code": 6032,
      "name": "invalidRebatePool",
      "msg": "Invalid rebate pool"
    },
    {
      "code": 6033,
      "name": "rebatePoolInsufficient",
      "msg": "Rebate pool insufficient funds"
    },
    {
      "code": 6034,
      "name": "userStatsNotFound",
      "msg": "User stats not found"
    }
  ],
  "types": [
    {
      "name": "adminTransferCancelled",
      "docs": [
        "Emitted when admin transfer is cancelled"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "cancelledNewAdmin",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "adminTransferProposed",
      "docs": [
        "Emitted when admin transfer is proposed (two-step transfer)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "currentAdmin",
            "type": "pubkey"
          },
          {
            "name": "proposedAdmin",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "adminTransferred",
      "docs": [
        "Emitted when admin transfer is completed"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldAdmin",
            "type": "pubkey"
          },
          {
            "name": "newAdmin",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ammFeesCollected",
      "docs": [
        "Emitted when AMM fees are collected (post-migration tokens)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "wsolAmount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "asdfMintUpdated",
      "docs": [
        "Emitted when ASDF mint is updated (TESTING mode only)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldMint",
            "type": "pubkey"
          },
          {
            "name": "newMint",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "buyExecuted",
      "docs": [
        "Emitted when a buy is executed"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokensBought",
            "type": "u64"
          },
          {
            "name": "solSpent",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "cycleCompleted",
      "docs": [
        "Emitted when a buyback cycle completes successfully"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cycleNumber",
            "type": "u32"
          },
          {
            "name": "tokensBurned",
            "type": "u64"
          },
          {
            "name": "solUsed",
            "type": "u64"
          },
          {
            "name": "totalBurned",
            "type": "u64"
          },
          {
            "name": "totalSolCollected",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "cycleFailed",
      "docs": [
        "Emitted when a cycle fails"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "failedCount",
            "type": "u32"
          },
          {
            "name": "consecutiveFailures",
            "type": "u8"
          },
          {
            "name": "errorCode",
            "type": "u32"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "datInitialized",
      "docs": [
        "Emitted when DAT state is initialized"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "datAuthority",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "datState",
      "docs": [
        "Global DAT configuration and statistics",
        "",
        "Stores system-wide settings, admin controls, and cumulative metrics.",
        "Only one DATState account exists per program instance."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "Current admin authority"
            ],
            "type": "pubkey"
          },
          {
            "name": "asdfMint",
            "docs": [
              "ASDF token mint address"
            ],
            "type": "pubkey"
          },
          {
            "name": "wsolMint",
            "docs": [
              "Wrapped SOL mint address"
            ],
            "type": "pubkey"
          },
          {
            "name": "poolAddress",
            "docs": [
              "PumpSwap pool address for ASDF"
            ],
            "type": "pubkey"
          },
          {
            "name": "pumpSwapProgram",
            "docs": [
              "PumpSwap program ID"
            ],
            "type": "pubkey"
          },
          {
            "name": "totalBurned",
            "docs": [
              "Total tokens burned across all cycles"
            ],
            "type": "u64"
          },
          {
            "name": "totalSolCollected",
            "docs": [
              "Total SOL collected across all cycles"
            ],
            "type": "u64"
          },
          {
            "name": "totalBuybacks",
            "docs": [
              "Total number of successful buyback cycles"
            ],
            "type": "u32"
          },
          {
            "name": "failedCycles",
            "docs": [
              "Total number of failed cycles"
            ],
            "type": "u32"
          },
          {
            "name": "consecutiveFailures",
            "docs": [
              "Consecutive failure count (resets on success)"
            ],
            "type": "u8"
          },
          {
            "name": "isActive",
            "docs": [
              "Whether DAT is active"
            ],
            "type": "bool"
          },
          {
            "name": "emergencyPause",
            "docs": [
              "Emergency pause flag"
            ],
            "type": "bool"
          },
          {
            "name": "lastCycleTimestamp",
            "docs": [
              "Timestamp of last cycle execution"
            ],
            "type": "i64"
          },
          {
            "name": "initializedAt",
            "docs": [
              "Timestamp when DAT was initialized"
            ],
            "type": "i64"
          },
          {
            "name": "lastAmExecution",
            "docs": [
              "Last AM execution timestamp (legacy, maintained for compatibility)"
            ],
            "type": "i64"
          },
          {
            "name": "lastPmExecution",
            "docs": [
              "Last PM execution timestamp (legacy, maintained for compatibility)"
            ],
            "type": "i64"
          },
          {
            "name": "lastCycleSol",
            "docs": [
              "SOL collected in last cycle"
            ],
            "type": "u64"
          },
          {
            "name": "lastCycleBurned",
            "docs": [
              "Tokens burned in last cycle"
            ],
            "type": "u64"
          },
          {
            "name": "minFeesThreshold",
            "docs": [
              "Minimum fees required to trigger cycle"
            ],
            "type": "u64"
          },
          {
            "name": "maxFeesPerCycle",
            "docs": [
              "Maximum fees allowed per cycle"
            ],
            "type": "u64"
          },
          {
            "name": "slippageBps",
            "docs": [
              "Slippage tolerance in basis points"
            ],
            "type": "u16"
          },
          {
            "name": "minCycleInterval",
            "docs": [
              "Minimum interval between cycles (seconds)"
            ],
            "type": "i64"
          },
          {
            "name": "datAuthorityBump",
            "docs": [
              "PDA bump for DAT authority"
            ],
            "type": "u8"
          },
          {
            "name": "currentFeeRecipientIndex",
            "docs": [
              "Current fee recipient index (for rotation)"
            ],
            "type": "u8"
          },
          {
            "name": "lastKnownPrice",
            "docs": [
              "Last known token price"
            ],
            "type": "u64"
          },
          {
            "name": "pendingBurnAmount",
            "docs": [
              "Pending burn amount (tokens waiting to be burned)"
            ],
            "type": "u64"
          },
          {
            "name": "rootTokenMint",
            "docs": [
              "Root token mint that receives 44.8% from secondaries"
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "feeSplitBps",
            "docs": [
              "Fee split in basis points: 5520 = 55.2% keep, 44.8% to root"
            ],
            "type": "u16"
          },
          {
            "name": "lastSolSentToRoot",
            "docs": [
              "SOL sent to root in last cycle (for stats tracking)"
            ],
            "type": "u64"
          },
          {
            "name": "pendingAdmin",
            "docs": [
              "Two-step admin transfer: proposed new admin"
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "pendingFeeSplit",
            "docs": [
              "Timelock: proposed fee split change"
            ],
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "pendingFeeSplitTimestamp",
            "docs": [
              "Timelock: when fee split was proposed"
            ],
            "type": "i64"
          },
          {
            "name": "adminOperationCooldown",
            "docs": [
              "Timelock: cooldown period in seconds (default 3600 = 1hr)"
            ],
            "type": "i64"
          },
          {
            "name": "lastDirectFeeSplitTimestamp",
            "docs": [
              "Last time update_fee_split was called (direct path)",
              "Separate from pending_fee_split_timestamp to prevent bypass attacks"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "emergencyAction",
      "docs": [
        "Emitted for emergency actions (pause/resume)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "action",
            "type": "string"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feeAsdfDeposited",
      "docs": [
        "Emitted when $ASDF fee is deposited via external app"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "burnAmount",
            "type": "u64"
          },
          {
            "name": "rebatePoolAmount",
            "type": "u64"
          },
          {
            "name": "pendingContribution",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feeSplitUpdated",
      "docs": [
        "Emitted when fee split ratio is updated"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "oldBps",
            "type": "u16"
          },
          {
            "name": "newBps",
            "type": "u16"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feesRedirectedToRoot",
      "docs": [
        "Emitted when fees are redirected from secondary to root token"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fromToken",
            "type": "pubkey"
          },
          {
            "name": "toRoot",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "pendingFeesUpdated",
      "docs": [
        "Emitted when pending fees are updated by daemon"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalPending",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rebatePool",
      "docs": [
        "Rebate Pool authority PDA for external app integration",
        "",
        "Self-sustaining model: automatically funded by 0.552% of each $ASDF deposit.",
        "The rebate pool ATA holds $ASDF tokens for distributing rebates to users.",
        "",
        "Architecture:",
        "- PDA: [\"rebate_pool\"] - Authority that can sign for ATA transfers",
        "- ATA: getATA(rebate_pool_pda, ASDF_MINT) - Holds rebate funds",
        "",
        "Funding flow:",
        "- deposit_fee_asdf() splits: 99.448% → DAT ATA, 0.552% → Rebate Pool ATA",
        "- process_user_rebate() transfers from pool → user ATA",
        "",
        "PDA Seeds: [\"rebate_pool\"]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "totalDeposited",
            "docs": [
              "Total $ASDF deposited to pool (lifetime)"
            ],
            "type": "u64"
          },
          {
            "name": "totalDistributed",
            "docs": [
              "Total $ASDF distributed as rebates (lifetime)"
            ],
            "type": "u64"
          },
          {
            "name": "rebatesCount",
            "docs": [
              "Number of rebates processed (lifetime)"
            ],
            "type": "u64"
          },
          {
            "name": "lastRebateTimestamp",
            "docs": [
              "Timestamp of last rebate distribution"
            ],
            "type": "i64"
          },
          {
            "name": "lastRebateSlot",
            "docs": [
              "Slot of last rebate distribution"
            ],
            "type": "u64"
          },
          {
            "name": "uniqueRecipients",
            "docs": [
              "Total users who received rebates (unique count)"
            ],
            "type": "u64"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for future use"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "rebatePoolInitialized",
      "docs": [
        "Emitted when rebate pool is initialized"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rebatePool",
            "type": "pubkey"
          },
          {
            "name": "rebatePoolAta",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rootTokenSet",
      "docs": [
        "Emitted when root token is set/changed"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rootMint",
            "type": "pubkey"
          },
          {
            "name": "feeSplitBps",
            "type": "u16"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "rootTreasuryCollected",
      "docs": [
        "Emitted when root treasury collects accumulated fees"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rootMint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "statusChanged",
      "docs": [
        "Emitted when DAT status changes (active/paused)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "isActive",
            "type": "bool"
          },
          {
            "name": "emergencyPause",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tokenCreated",
      "docs": [
        "Emitted when a new token is created via PumpFun"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "bondingCurve",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "symbol",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tokenStats",
      "docs": [
        "Per-token statistics tracking",
        "",
        "Each token in the ecosystem has its own TokenStats account",
        "to track individual metrics like burns, fees, and cycles."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "docs": [
              "The token mint this stats account tracks"
            ],
            "type": "pubkey"
          },
          {
            "name": "totalBurned",
            "docs": [
              "Total tokens burned for this specific token"
            ],
            "type": "u64"
          },
          {
            "name": "totalSolCollected",
            "docs": [
              "Total SOL collected/generated by this token"
            ],
            "type": "u64"
          },
          {
            "name": "totalSolUsed",
            "docs": [
              "Total SOL actually used for buybacks"
            ],
            "type": "u64"
          },
          {
            "name": "totalSolSentToRoot",
            "docs": [
              "SOL sent to root token (if secondary)"
            ],
            "type": "u64"
          },
          {
            "name": "totalSolReceivedFromOthers",
            "docs": [
              "SOL received from other tokens (if root)"
            ],
            "type": "u64"
          },
          {
            "name": "totalBuybacks",
            "docs": [
              "Number of buyback cycles for this token"
            ],
            "type": "u64"
          },
          {
            "name": "lastCycleTimestamp",
            "docs": [
              "Last cycle execution timestamp"
            ],
            "type": "i64"
          },
          {
            "name": "lastCycleSol",
            "docs": [
              "SOL collected in last cycle"
            ],
            "type": "u64"
          },
          {
            "name": "lastCycleBurned",
            "docs": [
              "Tokens burned in last cycle"
            ],
            "type": "u64"
          },
          {
            "name": "isRootToken",
            "docs": [
              "Whether this is the root token (receives 44.8% from all secondaries)"
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "pendingFeesLamports",
            "docs": [
              "Accumulated fees not yet collected (daemon tracks attribution)"
            ],
            "type": "u64"
          },
          {
            "name": "lastFeeUpdateTimestamp",
            "docs": [
              "Timestamp of last fee update"
            ],
            "type": "i64"
          },
          {
            "name": "cyclesParticipated",
            "docs": [
              "Number of ecosystem cycles this token participated in"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokenStatsInitialized",
      "docs": [
        "Emitted when per-token statistics are initialized"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "userRebateProcessed",
      "docs": [
        "Emitted when user rebate is processed"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "pendingBurned",
            "type": "u64"
          },
          {
            "name": "rebateAmount",
            "type": "u64"
          },
          {
            "name": "totalContributed",
            "type": "u64"
          },
          {
            "name": "totalRebate",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "userStats",
      "docs": [
        "User contribution statistics for external app integration",
        "",
        "Tracks individual user contributions from external apps paying in $ASDF.",
        "Users accumulate pending_contribution until selected in rebate lottery.",
        "",
        "PDA Seeds: [\"user_stats_v1\", user_pubkey]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "user",
            "docs": [
              "The user's wallet address"
            ],
            "type": "pubkey"
          },
          {
            "name": "pendingContribution",
            "docs": [
              "$ASDF pending contribution (awaiting rebate processing)",
              "Reset to 0 when user is selected for rebate"
            ],
            "type": "u64"
          },
          {
            "name": "totalContributed",
            "docs": [
              "Lifetime total $ASDF contributed"
            ],
            "type": "u64"
          },
          {
            "name": "totalRebate",
            "docs": [
              "Lifetime total $ASDF rebate received"
            ],
            "type": "u64"
          },
          {
            "name": "lastUpdateTimestamp",
            "docs": [
              "Proof-of-history: timestamp of last modification",
              "Updated on every deposit or rebate processing"
            ],
            "type": "i64"
          },
          {
            "name": "lastUpdateSlot",
            "docs": [
              "Proof-of-history: slot of last modification",
              "Additional verification for chronological order"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "userStatsInitialized",
      "docs": [
        "Emitted when user stats are initialized"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "userStats",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "validatedFeesRegistered",
      "docs": [
        "Emitted when validated fees are registered"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "endSlot",
            "type": "u64"
          },
          {
            "name": "txCount",
            "type": "u32"
          },
          {
            "name": "totalPending",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "validatorInitialized",
      "docs": [
        "Emitted when a validator is initialized for trustless fee tracking"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "bondingCurve",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "validatorSlotReset",
      "docs": [
        "Emitted when validator slot is reset (admin only)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "oldSlot",
            "type": "u64"
          },
          {
            "name": "newSlot",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "validatorSlotSynced",
      "docs": [
        "Emitted when validator slot is synced (permissionless, stale validators only)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "oldSlot",
            "type": "u64"
          },
          {
            "name": "newSlot",
            "type": "u64"
          },
          {
            "name": "slotDelta",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "validatorState",
      "docs": [
        "Validator state for trustless per-token fee attribution",
        "",
        "Tracks fees validated from PumpFun transaction logs.",
        "Used for cryptographic proof that fees were actually generated",
        "by specific token trades."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "docs": [
              "Token mint being tracked"
            ],
            "type": "pubkey"
          },
          {
            "name": "bondingCurve",
            "docs": [
              "Associated PumpFun bonding curve"
            ],
            "type": "pubkey"
          },
          {
            "name": "lastValidatedSlot",
            "docs": [
              "Last slot that was validated"
            ],
            "type": "u64"
          },
          {
            "name": "totalValidatedLamports",
            "docs": [
              "Cumulative fees validated historically"
            ],
            "type": "u64"
          },
          {
            "name": "totalValidatedCount",
            "docs": [
              "Number of validation batches"
            ],
            "type": "u64"
          },
          {
            "name": "feeRateBps",
            "docs": [
              "Expected fee rate in basis points (50 = 0.5%)"
            ],
            "type": "u16"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed"
            ],
            "type": "u8"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for future use"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ]
};
