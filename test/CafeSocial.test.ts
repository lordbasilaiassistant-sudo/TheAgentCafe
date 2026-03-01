import { expect } from "chai";
import { ethers } from "hardhat";
import { CafeSocial } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { mine } from "@nomicfoundation/hardhat-network-helpers";

describe("CafeSocial", function () {
  let social: CafeSocial;
  let agent1: HardhatEthersSigner;
  let agent2: HardhatEthersSigner;
  let agent3: HardhatEthersSigner;

  beforeEach(async function () {
    [agent1, agent2, agent3] = await ethers.getSigners();
    const CafeSocial = await ethers.getContractFactory("CafeSocial");
    social = await CafeSocial.deploy();
    await social.waitForDeployment();
  });

  describe("checkIn", function () {
    it("should allow an agent to check in", async function () {
      const tx = await social.connect(agent1).checkIn();
      const receipt = await tx.wait();
      const block = receipt!.blockNumber;

      await expect(tx)
        .to.emit(social, "AgentCheckedIn")
        .withArgs(agent1.address, block);

      const [checkInCount, lastCheckIn] = await social.getAgentProfile(agent1.address);
      expect(checkInCount).to.equal(1);
      expect(lastCheckIn).to.equal(block);
    });

    it("should increment check-in count on repeated check-ins", async function () {
      await social.connect(agent1).checkIn();
      await social.connect(agent1).checkIn();
      await social.connect(agent1).checkIn();

      const [checkInCount] = await social.getAgentProfile(agent1.address);
      expect(checkInCount).to.equal(3);
    });

    it("should track multiple agents as present", async function () {
      await social.connect(agent1).checkIn();
      await social.connect(agent2).checkIn();

      const count = await social.getActiveAgentCount();
      expect(count).to.equal(2);

      const present = await social.getPresentAgents();
      expect(present).to.include(agent1.address);
      expect(present).to.include(agent2.address);
    });
  });

  describe("check-in expiry", function () {
    it("should expire check-in after CHECK_IN_WINDOW blocks", async function () {
      await social.connect(agent1).checkIn();
      expect(await social.getActiveAgentCount()).to.equal(1);

      // Mine 1201 blocks to exceed the 1200-block window
      await mine(1201);

      expect(await social.getActiveAgentCount()).to.equal(0);
      const present = await social.getPresentAgents();
      expect(present.length).to.equal(0);
    });

    it("should keep agent present within CHECK_IN_WINDOW blocks", async function () {
      await social.connect(agent1).checkIn();

      // Mine 1199 blocks — should still be present
      await mine(1199);

      expect(await social.getActiveAgentCount()).to.equal(1);
    });
  });

  describe("postMessage", function () {
    it("should allow checked-in agent to post a message", async function () {
      await social.connect(agent1).checkIn();
      const msg = "Hello from agent1!";

      const tx = await social.connect(agent1).postMessage(msg);
      await expect(tx).to.emit(social, "ChatMessagePosted");

      const messages = await social.getRecentMessages(1);
      expect(messages.length).to.equal(1);
      expect(messages[0].sender).to.equal(agent1.address);
      expect(messages[0].message).to.equal(msg);
    });

    it("should reject message from non-checked-in agent", async function () {
      await expect(
        social.connect(agent1).postMessage("hello")
      ).to.be.revertedWith("Not checked in");
    });

    it("should reject empty message", async function () {
      await social.connect(agent1).checkIn();
      await expect(
        social.connect(agent1).postMessage("")
      ).to.be.revertedWith("Empty message");
    });

    it("should reject message over 280 bytes", async function () {
      await social.connect(agent1).checkIn();
      const longMsg = "A".repeat(281);
      await expect(
        social.connect(agent1).postMessage(longMsg)
      ).to.be.revertedWith("Message too long");
    });

    it("should accept message at exactly 280 bytes", async function () {
      await social.connect(agent1).checkIn();
      const msg = "A".repeat(280);
      await social.connect(agent1).postMessage(msg);

      const messages = await social.getRecentMessages(1);
      expect(messages[0].message).to.equal(msg);
    });

    it("should increment messageCount in profile", async function () {
      await social.connect(agent1).checkIn();
      await social.connect(agent1).postMessage("msg1");
      await social.connect(agent1).postMessage("msg2");

      const [, , messageCount] = await social.getAgentProfile(agent1.address);
      expect(messageCount).to.equal(2);
    });
  });

  describe("getRecentMessages", function () {
    it("should return messages newest first", async function () {
      await social.connect(agent1).checkIn();
      await social.connect(agent1).postMessage("first");
      await social.connect(agent1).postMessage("second");
      await social.connect(agent1).postMessage("third");

      const messages = await social.getRecentMessages(3);
      expect(messages[0].message).to.equal("third");
      expect(messages[1].message).to.equal("second");
      expect(messages[2].message).to.equal("first");
    });

    it("should cap at available messages", async function () {
      await social.connect(agent1).checkIn();
      await social.connect(agent1).postMessage("only one");

      const messages = await social.getRecentMessages(10);
      expect(messages.length).to.equal(1);
    });

    it("should return empty array when no messages", async function () {
      const messages = await social.getRecentMessages(5);
      expect(messages.length).to.equal(0);
    });
  });

  describe("socializeWith", function () {
    it("should record social interaction between two checked-in agents", async function () {
      await social.connect(agent1).checkIn();
      await social.connect(agent2).checkIn();

      const tx = await social.connect(agent1).socializeWith(agent2.address);
      await expect(tx)
        .to.emit(social, "AgentSocialized")
        .withArgs(agent1.address, agent2.address);

      const [, , , socializations1] = await social.getAgentProfile(agent1.address);
      const [, , , socializations2] = await social.getAgentProfile(agent2.address);
      expect(socializations1).to.equal(1);
      expect(socializations2).to.equal(1);
    });

    it("should reject if caller is not checked in", async function () {
      await social.connect(agent2).checkIn();
      await expect(
        social.connect(agent1).socializeWith(agent2.address)
      ).to.be.revertedWith("Not checked in");
    });

    it("should reject if other agent is not checked in", async function () {
      await social.connect(agent1).checkIn();
      await expect(
        social.connect(agent1).socializeWith(agent2.address)
      ).to.be.revertedWith("Other agent not checked in");
    });

    it("should reject socializing with yourself", async function () {
      await social.connect(agent1).checkIn();
      await expect(
        social.connect(agent1).socializeWith(agent1.address)
      ).to.be.revertedWith("Cannot socialize with yourself");
    });
  });

  describe("getAgentProfile", function () {
    it("should return zeros for unknown agent", async function () {
      const [checkInCount, lastCheckIn, messageCount, socializations] =
        await social.getAgentProfile(agent3.address);
      expect(checkInCount).to.equal(0);
      expect(lastCheckIn).to.equal(0);
      expect(messageCount).to.equal(0);
      expect(socializations).to.equal(0);
    });

    it("should track all profile fields correctly", async function () {
      await social.connect(agent1).checkIn();
      await social.connect(agent2).checkIn();
      await social.connect(agent1).postMessage("hello");
      await social.connect(agent1).socializeWith(agent2.address);

      const [checkInCount, , messageCount, socializations] =
        await social.getAgentProfile(agent1.address);
      expect(checkInCount).to.equal(1);
      expect(messageCount).to.equal(1);
      expect(socializations).to.equal(1);
    });
  });

  describe("presence array cap (MAX_PRESENT_AGENTS = 100)", function () {
    it("should allow up to 100 unique agents to check in", async function () {
      const signers = await ethers.getSigners();
      // We need 100 signers — Hardhat default provides 20, so we'll test with what we have
      const count = Math.min(signers.length, 100);
      for (let i = 0; i < count; i++) {
        await social.connect(signers[i]).checkIn();
      }
      const activeCount = await social.getActiveAgentCount();
      expect(activeCount).to.equal(count);
    });

    it("should evict expired agent when array is full", async function () {
      // Deploy fresh contract and fill with 100 agents using CREATE2-style approach
      // Since Hardhat only gives ~20 signers, we'll use a smaller-scale simulation
      // by testing the logic with available signers + time expiry

      const signers = await ethers.getSigners();

      // Check in all available signers
      for (let i = 0; i < signers.length; i++) {
        await social.connect(signers[i]).checkIn();
      }

      // Expire all check-ins
      await mine(1201);

      // Now none are present
      expect(await social.getActiveAgentCount()).to.equal(0);

      // But array still has entries — re-check-in should not grow the array
      // (they already have _presentIndex set)
      await social.connect(signers[0]).checkIn();
      expect(await social.getActiveAgentCount()).to.equal(1);
    });

    it("should revert when cafe is full and no expired slots", async function () {
      // We need exactly MAX_PRESENT_AGENTS (100) active agents with no expired slots
      // Since Hardhat default has ~20 signers, we deploy a helper to test with wallets
      // Instead, we test the revert path by deploying with a modified scenario:
      // Fill array, keep all active, try to add new agent

      // This test requires 101 distinct addresses. We'll generate wallets.
      const wallets: any[] = [];
      const provider = ethers.provider;
      const [funder] = await ethers.getSigners();

      for (let i = 0; i < 101; i++) {
        const wallet = ethers.Wallet.createRandom().connect(provider);
        wallets.push(wallet);
        // Fund each wallet with enough for gas
        await funder.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther("0.01"),
        });
      }

      // Check in 100 agents
      for (let i = 0; i < 100; i++) {
        await social.connect(wallets[i]).checkIn();
      }

      expect(await social.getActiveAgentCount()).to.equal(100);

      // 101st agent should revert — all 100 are still active
      await expect(
        social.connect(wallets[100]).checkIn()
      ).to.be.revertedWith("Cafe is full -- try again later");
    });

    it("should evict expired agent and seat new agent when full", async function () {
      const wallets: any[] = [];
      const provider = ethers.provider;
      const [funder] = await ethers.getSigners();

      for (let i = 0; i < 101; i++) {
        const wallet = ethers.Wallet.createRandom().connect(provider);
        wallets.push(wallet);
        await funder.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther("0.01"),
        });
      }

      // Check in 100 agents
      for (let i = 0; i < 100; i++) {
        await social.connect(wallets[i]).checkIn();
      }

      // Expire all check-ins
      await mine(1201);
      expect(await social.getActiveAgentCount()).to.equal(0);

      // Now agent 100 should be able to check in by evicting an expired slot
      await social.connect(wallets[100]).checkIn();
      expect(await social.getActiveAgentCount()).to.equal(1);

      const present = await social.getPresentAgents();
      expect(present.length).to.equal(1);
      expect(present[0]).to.equal(wallets[100].address);
    });

    it("should not duplicate agent already in array on re-check-in", async function () {
      await social.connect(agent1).checkIn();
      await social.connect(agent1).checkIn();
      await social.connect(agent1).checkIn();

      const present = await social.getPresentAgents();
      // Should only appear once
      expect(present.length).to.equal(1);
      expect(present[0]).to.equal(agent1.address);
    });
  });

  describe("ring buffer overflow", function () {
    it("should overwrite oldest messages when buffer is full", async function () {
      await social.connect(agent1).checkIn();

      // Post 101 messages (buffer is 100)
      for (let i = 0; i < 101; i++) {
        await social.connect(agent1).postMessage(`msg-${i}`);
      }

      const totalMessages = await social.totalMessages();
      expect(totalMessages).to.equal(101);

      // Most recent should be msg-100
      const messages = await social.getRecentMessages(1);
      expect(messages[0].message).to.equal("msg-100");

      // Oldest available should be msg-1 (msg-0 was overwritten)
      const allMessages = await social.getRecentMessages(100);
      expect(allMessages[99].message).to.equal("msg-1");
    });
  });
});
