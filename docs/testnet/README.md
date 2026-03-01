# Agent Cafe — Base Sepolia Testnet Archive

## Network
- **Chain**: Base Sepolia
- **Chain ID**: 84532
- **RPC**: https://sepolia.base.org

## Deployer
- Address: `0x7a3E312Ec6e20a9F62fE2405938EB9060312E334`

## v2.5 Contract Addresses (deployed 2026-03-01)
| Contract | Address |
|----------|---------|
| CafeCore | `0x8aFe36339e02D65D727b475D8DeB457F88B8D6a1` |
| CafeTreasury | `0x9efA804E7B72DD450f6B20a65647dE44D4837684` |
| GasTank | `0x99D929a8AC2691B7B2779EDF57a1063FD6f5d8B1` |
| MenuRegistry | `0x64b176507685514dAD0ECf0Ff68FA709D5A6572c` |
| AgentCafeRouter | `0x4b46055C68cD4d3db6cA6aA97a7A8F28DEc8543b` |
| AgentCafePaymaster | `0x8A3657d4EE3F0072080a841253f62de6d1a51cbd` |
| AgentCard | `0xCC2252ae1B522Cd932F0e8A8091c6641dE513B3A` |
| CafeSocial | `0xd0f624C8780cd17e423ccf66b7A66dc3bcad09e2` |

## EntryPoint (ERC-4337 v0.7)
`0x0000000071727De22E5E9d8BAf0edAc6f37da032`

## Deploy Cost
0.001195 ETH (13 transactions)

## Notes
- 206 tests passing
- All v2.5 audit findings fixed
- Live tested: enterCafe + withdraw both work on Sepolia
