/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/asdf_dat.json`.
 */
export type AsdfDat = {
  "address": "ASDFznSwUWikqQMNE1Y7qqskDDkbE74GXZdUe6wu4UCz",
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
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
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
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
          "name": "poolWsolAccount",
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
          "name": "protocolFeeRecipientAta",
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
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executeFullCycle",
      "docs": [
        "Execute full DAT cycle in one transaction: COLLECT → BUY → BURN"
      ],
      "discriminator": [
        74,
        198,
        91,
        104,
        130,
        92,
        97,
        244
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
          "name": "creatorVault",
          "writable": true
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
          "name": "poolWsolAccount",
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
          "name": "protocolFeeRecipientAta",
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
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
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
          "writable": true
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
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
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
    }
  ]
};
