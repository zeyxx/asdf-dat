/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/asdf_dat.json`.
 */
export type AsdfDat = {
  "address": "ASDFwdvE6Uc72DGEQVT6c5UwCoL1JdBAayjZmFR6NWM5",
  "metadata": {
    "name": "asdfDat",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "ASDF DAT"
  },
  "instructions": [
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
      "name": "createPumpfunToken",
      "discriminator": [
        32,
        217,
        77,
        209,
        89,
        36,
        65,
        35
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
          "name": "mintAuthority",
          "writable": true
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
          "name": "metadata",
          "writable": true
        },
        {
          "name": "global",
          "writable": true
        },
        {
          "name": "mplTokenMetadata"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent"
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
        "Requires WSOL in dat_wsol_account for the buy operation"
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
            "DAT's token account for receiving bought tokens"
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
        "PERMISSIONLESS - Register validated fees extracted from PumpFun transaction logs",
        "Anyone can call this to commit fee data from off-chain validation",
        "",
        "Security: Protected by slot progression and fee caps"
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
        }
      ],
      "args": []
    },
    {
      "name": "transferAdmin",
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
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "datNotActive",
      "msg": "DAT not active"
    },
    {
      "code": 6001,
      "name": "insufficientFees",
      "msg": "Insufficient fees"
    },
    {
      "code": 6002,
      "name": "unauthorizedAccess",
      "msg": "unauthorized"
    },
    {
      "code": 6003,
      "name": "cycleTooSoon",
      "msg": "Cycle too soon"
    },
    {
      "code": 6004,
      "name": "invalidParameter",
      "msg": "Invalid parameter"
    },
    {
      "code": 6005,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6006,
      "name": "alreadyExecutedThisPeriod",
      "msg": "Already executed"
    },
    {
      "code": 6007,
      "name": "slippageExceeded",
      "msg": "Slippage exceeded"
    },
    {
      "code": 6008,
      "name": "notCoinCreator",
      "msg": "Not coin creator"
    },
    {
      "code": 6009,
      "name": "priceImpactTooHigh",
      "msg": "Price impact too high"
    },
    {
      "code": 6010,
      "name": "rateTooLow",
      "msg": "Rate too low"
    },
    {
      "code": 6011,
      "name": "vaultNotInitialized",
      "msg": "Vault not initialized"
    },
    {
      "code": 6012,
      "name": "noPendingBurn",
      "msg": "No pending burn"
    },
    {
      "code": 6013,
      "name": "invalidPool",
      "msg": "Invalid pool data"
    },
    {
      "code": 6014,
      "name": "invalidRootToken",
      "msg": "Invalid root token"
    },
    {
      "code": 6015,
      "name": "invalidRootTreasury",
      "msg": "Invalid root treasury"
    },
    {
      "code": 6016,
      "name": "invalidFeeSplit",
      "msg": "Invalid fee split basis points"
    },
    {
      "code": 6017,
      "name": "insufficientPoolLiquidity",
      "msg": "Insufficient pool liquidity"
    },
    {
      "code": 6018,
      "name": "staleValidation",
      "msg": "Stale validation - slot already processed"
    },
    {
      "code": 6019,
      "name": "slotRangeTooLarge",
      "msg": "Slot range too large"
    },
    {
      "code": 6020,
      "name": "validatorNotStale",
      "msg": "Validator not stale - sync not needed"
    },
    {
      "code": 6021,
      "name": "feeTooHigh",
      "msg": "Fee amount exceeds maximum for slot range"
    },
    {
      "code": 6022,
      "name": "tooManyTransactions",
      "msg": "Transaction count exceeds maximum for slot range"
    },
    {
      "code": 6023,
      "name": "invalidBondingCurve",
      "msg": "Invalid bonding curve account"
    },
    {
      "code": 6024,
      "name": "mintMismatch",
      "msg": "Mint mismatch between accounts"
    }
  ],
  "types": [
    {
      "name": "adminTransferred",
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
      "name": "buyExecuted",
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
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "asdfMint",
            "type": "pubkey"
          },
          {
            "name": "wsolMint",
            "type": "pubkey"
          },
          {
            "name": "poolAddress",
            "type": "pubkey"
          },
          {
            "name": "pumpSwapProgram",
            "type": "pubkey"
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
            "name": "totalBuybacks",
            "type": "u32"
          },
          {
            "name": "failedCycles",
            "type": "u32"
          },
          {
            "name": "consecutiveFailures",
            "type": "u8"
          },
          {
            "name": "isActive",
            "type": "bool"
          },
          {
            "name": "emergencyPause",
            "type": "bool"
          },
          {
            "name": "lastCycleTimestamp",
            "type": "i64"
          },
          {
            "name": "initializedAt",
            "type": "i64"
          },
          {
            "name": "lastAmExecution",
            "type": "i64"
          },
          {
            "name": "lastPmExecution",
            "type": "i64"
          },
          {
            "name": "lastCycleSol",
            "type": "u64"
          },
          {
            "name": "lastCycleBurned",
            "type": "u64"
          },
          {
            "name": "minFeesThreshold",
            "type": "u64"
          },
          {
            "name": "maxFeesPerCycle",
            "type": "u64"
          },
          {
            "name": "slippageBps",
            "type": "u16"
          },
          {
            "name": "minCycleInterval",
            "type": "i64"
          },
          {
            "name": "datAuthorityBump",
            "type": "u8"
          },
          {
            "name": "currentFeeRecipientIndex",
            "type": "u8"
          },
          {
            "name": "lastKnownPrice",
            "type": "u64"
          },
          {
            "name": "pendingBurnAmount",
            "type": "u64"
          },
          {
            "name": "rootTokenMint",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "feeSplitBps",
            "type": "u16"
          },
          {
            "name": "lastSolSentToRoot",
            "type": "u64"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                22
              ]
            }
          }
        ]
      }
    },
    {
      "name": "emergencyAction",
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
      "name": "feeSplitUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "newFeeSplitBps",
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
      "name": "rootTokenSet",
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
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
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
            "name": "totalSolUsed",
            "type": "u64"
          },
          {
            "name": "totalSolSentToRoot",
            "type": "u64"
          },
          {
            "name": "totalSolReceivedFromOthers",
            "type": "u64"
          },
          {
            "name": "totalBuybacks",
            "type": "u64"
          },
          {
            "name": "lastCycleTimestamp",
            "type": "i64"
          },
          {
            "name": "lastCycleSol",
            "type": "u64"
          },
          {
            "name": "lastCycleBurned",
            "type": "u64"
          },
          {
            "name": "isRootToken",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "pendingFeesLamports",
            "type": "u64"
          },
          {
            "name": "lastFeeUpdateTimestamp",
            "type": "i64"
          },
          {
            "name": "cyclesParticipated",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokenStatsInitialized",
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
      "name": "validatedFeesRegistered",
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
      "name": "validatorState",
      "docs": [
        "Validator state for trustless per-token fee attribution",
        "Tracks fees validated from PumpFun transaction logs"
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
            "name": "lastValidatedSlot",
            "type": "u64"
          },
          {
            "name": "totalValidatedLamports",
            "type": "u64"
          },
          {
            "name": "totalValidatedCount",
            "type": "u64"
          },
          {
            "name": "feeRateBps",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserved",
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
