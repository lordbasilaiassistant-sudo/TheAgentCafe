import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Base Sepolia EntryPoint v0.7
const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const AgentCafeModule = buildModule("AgentCafe", (m) => {
  // 1. Deploy CafeCore (bonding curve for BEAN)
  const cafeCore = m.contract("CafeCore");

  // 2. Deploy CafeTreasury (holds BEAN revenue)
  const cafeTreasury = m.contract("CafeTreasury", [cafeCore]);

  // 3. Wire treasury into CafeCore (one-time setter)
  m.call(cafeCore, "setTreasury", [cafeTreasury], { id: "wireTreasury" });

  // 4. Deploy GasTank (real ETH gas tank for agents)
  const gasTank = m.contract("GasTank");

  // 5. Deploy MenuRegistry (needs CafeCore as bean token, CafeTreasury)
  const menuRegistry = m.contract("MenuRegistry", [cafeCore, cafeTreasury]);

  // 6. Deploy AgentCafeRouter (one-tx entry point)
  const router = m.contract("AgentCafeRouter", [
    cafeCore,
    menuRegistry,
    gasTank,
    cafeTreasury, // owner treasury for 5% fee
  ]);

  // 7. Authorize router as caller on MenuRegistry
  m.call(menuRegistry, "setAuthorizedCaller", [router, true], {
    id: "authorizeRouter",
  });

  // 8. Deploy AgentCafePaymaster (ERC-4337 — uses GasTank)
  const entryPoint = m.getParameter("entryPoint", ENTRY_POINT_V07);
  const paymaster = m.contract("AgentCafePaymaster", [entryPoint, gasTank]);

  // 9. Wire paymaster into MenuRegistry (legacy support)
  m.call(menuRegistry, "setPaymaster", [paymaster], { id: "wirePaymaster" });

  // 10. Authorize paymaster as deducter on GasTank
  m.call(gasTank, "setAuthorizedDeducter", [paymaster, true], {
    id: "authorizePaymaster",
  });

  // 11. Authorize router as deducter on GasTank (for future use)
  m.call(gasTank, "setAuthorizedDeducter", [router, true], {
    id: "authorizeRouter_gasTank",
  });

  // 12. Deploy AgentCard (needs MenuRegistry, GasTank, Router)
  const agentCard = m.contract("AgentCard", [menuRegistry, gasTank, router]);

  return {
    cafeCore,
    cafeTreasury,
    gasTank,
    menuRegistry,
    router,
    paymaster,
    agentCard,
  };
});

export default AgentCafeModule;
