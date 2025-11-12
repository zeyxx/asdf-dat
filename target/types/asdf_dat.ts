/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/asdf_dat.json`.
 */
export type AsdfDat = {
  "address": "EJdSbSXMXQLp7WLqgVYjJ6a6BqMw6t8MzfavWQBZM6a2",
  "metadata": {
    "name": "asdfDat",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "ASDF DAT - Automated Buyback and Burn Protocol"
  },
  "instructions": [
    {
      "name": "initialize",
      "discriminator": [175, 175, 109, 31, 13, 152, 155, 237],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "datState",
          "writable": true
        },
        {
          "name": "datAuthority"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "executeCycle",
      "discriminator": [99, 65, 252, 202, 201, 232, 89, 78],
      "accounts": [
        {
          "name": "executor",
          "writable": true,
          "signer": true
        },
        {
          "name": "datState",
          "writable": true
        },
        {
          "name": "datAuthority"
        },
        {
          "name": "asdfMint",
          "writable": true
        },
        {
          "name": "wsolMint"
        },
        {
          "name": "pool",
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
          "name": "datWsolAccount",
          "writable": true
        },
        {
          "name": "datAsdfAccount",
          "writable": true
        },
        {
          "name": "creatorVaultAuthority"
        },
        {
          "name": "creatorVault",
          "writable": true
        },
        {
          "name": "pumpSwapProgram"
        },
        {
          "name": "pumpGlobalConfig"
        },
        {
          "name": "pumpEventAuthority"
        },
        {
          "name": "globalVolumeAccumulator",
          "writable": true
        },
        {
          "name": "feeProgram"
        },
        {
          "name": "protocolFeeRecipient",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "recordFailure",
      "discriminator": [159, 86, 106, 111, 181, 7, 62, 228],
      "accounts": [
        {
          "name": "executor",
          "signer": true
        },
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
      "name": "emergencyPause",
      "discriminator": [218, 241, 163, 30, 208, 164, 164, 139],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "datState",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "resume",
      "discriminator": [34, 228, 199, 217, 157, 216, 208, 124],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "datState",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "updateParameters",
      "discriminator": [118, 29, 223, 189, 63, 12, 250, 233],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "datState",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "minFeesThreshold",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "maxFeesPerCycle",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "slippageBps",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "minCycleInterval",
          "type": {
            "option": "i64"
          }
        }
      ]
    },
    {
      "name": "transferAdmin",
      "discriminator": [157, 66, 204, 117, 86, 172, 122, 220],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "newAdmin"
        },
        {
          "name": "datState",
          "writable": true
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "datState",
      "discriminator": [102, 197, 213, 170, 232, 138, 159, 29]
    }
  ],
  "events": [
    {
      "name": "datInitialized",
      "discriminator": [192, 243, 65, 98, 130, 102, 233, 248]
    },
    {
      "name": "cycleCompleted",
      "discriminator": [95, 159, 226, 201, 12, 112, 167, 123]
    },
    {
      "name": "cycleFailed",
      "discriminator": [124, 89, 215, 176, 224, 245, 40, 151]
    },
    {
      "name": "statusChanged",
      "discriminator": [237, 115, 23, 97, 184, 90, 65, 119]
    },
    {
      "name": "emergencyAction",
      "discriminator": [58, 189, 126, 219, 204, 100, 135, 211]
    },
    {
      "name": "adminTransferred",
      "discriminator": [214, 19, 132, 98, 37, 126, 237, 241]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Unauthorized access"
    },
    {
      "code": 6001,
      "name": "alreadyInitialized",
      "msg": "State already initialized"
    },
    {
      "code": 6002,
      "name": "notInitialized",
      "msg": "State not initialized"
    },
    {
      "code": 6003,
      "name": "invalidMint",
      "msg": "Invalid mint address"
    },
    {
      "code": 6004,
      "name": "invalidPool",
      "msg": "Invalid pool address"
    },
    {
      "code": 6005,
      "name": "emergencyPauseActive",
      "msg": "Emergency pause is active"
    },
    {
      "code": 6006,
      "name": "cooldownPeriod",
      "msg": "Cooldown period not elapsed"
    },
    {
      "code": 6007,
      "name": "insufficientFees",
      "msg": "Insufficient fees to claim"
    },
    {
      "code": 6008,
      "name": "excessiveFees",
      "msg": "Fees exceed maximum per cycle"
    },
    {
      "code": 6009,
      "name": "slippageExceeded",
      "msg": "Slippage tolerance exceeded"
    },
    {
      "code": 6010,
      "name": "insufficientBalance",
      "msg": "Insufficient balance"
    },
    {
      "code": 6011,
      "name": "invalidParameters",
      "msg": "Invalid parameters"
    },
    {
      "code": 6012,
      "name": "mathOverflow",
      "msg": "Math operation overflow"
    },
    {
      "code": 6013,
      "name": "priceImpactTooHigh",
      "msg": "Price impact too high"
    },
    {
      "code": 6014,
      "name": "tooManyConsecutiveFailures",
      "msg": "Too many consecutive failures"
    },
    {
      "code": 6015,
      "name": "invalidTimestamp",
      "msg": "Invalid timestamp"
    }
  ],
  "types": [
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
      "name": "cycleCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "executor",
            "type": "pubkey"
          },
          {
            "name": "solCollected",
            "type": "u64"
          },
          {
            "name": "tokensBurned",
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
            "name": "executor",
            "type": "pubkey"
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
      "name": "statusChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "isActive",
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
      "name": "emergencyAction",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "action",
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
    }
  ]
};

export const IDL: AsdfDat = {
  "address": "EJdSbSXMXQLp7WLqgVYjJ6a6BqMw6t8MzfavWQBZM6a2",
  "metadata": {
    "name": "asdfDat",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "ASDF DAT - Automated Buyback and Burn Protocol"
  },
  "instructions": [
    {
      "name": "initialize",
      "discriminator": [175, 175, 109, 31, 13, 152, 155, 237],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "datState",
          "writable": true
        },
        {
          "name": "datAuthority"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "executeCycle",
      "discriminator": [99, 65, 252, 202, 201, 232, 89, 78],
      "accounts": [
        {
          "name": "executor",
          "writable": true,
          "signer": true
        },
        {
          "name": "datState",
          "writable": true
        },
        {
          "name": "datAuthority"
        },
        {
          "name": "asdfMint",
          "writable": true
        },
        {
          "name": "wsolMint"
        },
        {
          "name": "pool",
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
          "name": "datWsolAccount",
          "writable": true
        },
        {
          "name": "datAsdfAccount",
          "writable": true
        },
        {
          "name": "creatorVaultAuthority"
        },
        {
          "name": "creatorVault",
          "writable": true
        },
        {
          "name": "pumpSwapProgram"
        },
        {
          "name": "pumpGlobalConfig"
        },
        {
          "name": "pumpEventAuthority"
        },
        {
          "name": "globalVolumeAccumulator",
          "writable": true
        },
        {
          "name": "feeProgram"
        },
        {
          "name": "protocolFeeRecipient",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "recordFailure",
      "discriminator": [159, 86, 106, 111, 181, 7, 62, 228],
      "accounts": [
        {
          "name": "executor",
          "signer": true
        },
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
      "name": "emergencyPause",
      "discriminator": [218, 241, 163, 30, 208, 164, 164, 139],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "datState",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "resume",
      "discriminator": [34, 228, 199, 217, 157, 216, 208, 124],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "datState",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "updateParameters",
      "discriminator": [118, 29, 223, 189, 63, 12, 250, 233],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "datState",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "minFeesThreshold",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "maxFeesPerCycle",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "slippageBps",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "minCycleInterval",
          "type": {
            "option": "i64"
          }
        }
      ]
    },
    {
      "name": "transferAdmin",
      "discriminator": [157, 66, 204, 117, 86, 172, 122, 220],
      "accounts": [
        {
          "name": "admin",
          "signer": true
        },
        {
          "name": "newAdmin"
        },
        {
          "name": "datState",
          "writable": true
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "datState",
      "discriminator": [102, 197, 213, 170, 232, 138, 159, 29]
    }
  ],
  "events": [
    {
      "name": "datInitialized",
      "discriminator": [192, 243, 65, 98, 130, 102, 233, 248]
    },
    {
      "name": "cycleCompleted",
      "discriminator": [95, 159, 226, 201, 12, 112, 167, 123]
    },
    {
      "name": "cycleFailed",
      "discriminator": [124, 89, 215, 176, 224, 245, 40, 151]
    },
    {
      "name": "statusChanged",
      "discriminator": [237, 115, 23, 97, 184, 90, 65, 119]
    },
    {
      "name": "emergencyAction",
      "discriminator": [58, 189, 126, 219, 204, 100, 135, 211]
    },
    {
      "name": "adminTransferred",
      "discriminator": [214, 19, 132, 98, 37, 126, 237, 241]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Unauthorized access"
    },
    {
      "code": 6001,
      "name": "alreadyInitialized",
      "msg": "State already initialized"
    },
    {
      "code": 6002,
      "name": "notInitialized",
      "msg": "State not initialized"
    },
    {
      "code": 6003,
      "name": "invalidMint",
      "msg": "Invalid mint address"
    },
    {
      "code": 6004,
      "name": "invalidPool",
      "msg": "Invalid pool address"
    },
    {
      "code": 6005,
      "name": "emergencyPauseActive",
      "msg": "Emergency pause is active"
    },
    {
      "code": 6006,
      "name": "cooldownPeriod",
      "msg": "Cooldown period not elapsed"
    },
    {
      "code": 6007,
      "name": "insufficientFees",
      "msg": "Insufficient fees to claim"
    },
    {
      "code": 6008,
      "name": "excessiveFees",
      "msg": "Fees exceed maximum per cycle"
    },
    {
      "code": 6009,
      "name": "slippageExceeded",
      "msg": "Slippage tolerance exceeded"
    },
    {
      "code": 6010,
      "name": "insufficientBalance",
      "msg": "Insufficient balance"
    },
    {
      "code": 6011,
      "name": "invalidParameters",
      "msg": "Invalid parameters"
    },
    {
      "code": 6012,
      "name": "mathOverflow",
      "msg": "Math operation overflow"
    },
    {
      "code": 6013,
      "name": "priceImpactTooHigh",
      "msg": "Price impact too high"
    },
    {
      "code": 6014,
      "name": "tooManyConsecutiveFailures",
      "msg": "Too many consecutive failures"
    },
    {
      "code": 6015,
      "name": "invalidTimestamp",
      "msg": "Invalid timestamp"
    }
  ],
  "types": [
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
      "name": "cycleCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "executor",
            "type": "pubkey"
          },
          {
            "name": "solCollected",
            "type": "u64"
          },
          {
            "name": "tokensBurned",
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
            "name": "executor",
            "type": "pubkey"
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
      "name": "statusChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "isActive",
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
      "name": "emergencyAction",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "action",
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
    }
  ]
};
