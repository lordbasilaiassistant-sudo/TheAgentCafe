// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title CafeSocial — Social layer for The Agent Cafe
/// @notice Agents check in, chat, and socialize at the cafe.
///         Standalone contract — does NOT modify the enterCafe() flow.
/// @dev Check-ins auto-expire after CHECK_IN_WINDOW blocks (~40 min on Base at 2s blocks).
contract CafeSocial {
    /// @notice Blocks before a check-in expires (~40 min at 2s blocks)
    uint256 public constant CHECK_IN_WINDOW = 1200;

    /// @notice Maximum message length in bytes
    uint256 public constant MAX_MESSAGE_LENGTH = 280;

    /// @notice Maximum number of messages stored in the ring buffer
    uint256 public constant MAX_STORED_MESSAGES = 100;

    /// @notice Maximum number of agents tracked in the presence array
    uint256 public constant MAX_PRESENT_AGENTS = 100;

    struct ChatMessage {
        address sender;
        string message;
        uint256 blockNumber;
        uint256 timestamp;
    }

    struct AgentProfile {
        uint256 checkInCount;
        uint256 lastCheckIn;
        uint256 messageCount;
        uint256 socializations;
    }

    /// @notice Agent profiles
    mapping(address => AgentProfile) public profiles;

    /// @notice Ring buffer of chat messages
    ChatMessage[100] private _messages;
    uint256 public messageWriteIndex;
    uint256 public totalMessages;

    /// @notice Tracked present agents (addresses that have checked in)
    address[] private _presentAgents;
    mapping(address => uint256) private _presentIndex; // 1-indexed (0 = not in array)

    // --- Events ---

    event AgentCheckedIn(address indexed agent, uint256 blockNumber);
    event ChatMessagePosted(address indexed agent, string message, uint256 blockNumber);
    event AgentSocialized(address indexed agent1, address indexed agent2);

    // --- Modifiers ---

    modifier onlyCheckedIn() {
        require(_isPresent(msg.sender), "Not checked in");
        _;
    }

    // --- Core Functions ---

    /// @notice Check in to the cafe. Auto-expires after CHECK_IN_WINDOW blocks.
    /// @dev Capped at MAX_PRESENT_AGENTS. When full, expired slots are reclaimed.
    function checkIn() external {
        AgentProfile storage profile = profiles[msg.sender];
        profile.checkInCount++;
        profile.lastCheckIn = block.number;

        // Add to present agents if not already tracked
        if (_presentIndex[msg.sender] == 0) {
            if (_presentAgents.length < MAX_PRESENT_AGENTS) {
                _presentAgents.push(msg.sender);
                _presentIndex[msg.sender] = _presentAgents.length; // 1-indexed
            } else {
                // Array is full — find an expired slot to reclaim
                uint256 slot = _findExpiredSlot();
                require(slot != type(uint256).max, "Cafe is full -- try again later");

                // Evict the expired agent
                address evicted = _presentAgents[slot];
                _presentIndex[evicted] = 0;

                // Replace with new agent
                _presentAgents[slot] = msg.sender;
                _presentIndex[msg.sender] = slot + 1; // 1-indexed
            }
        }

        emit AgentCheckedIn(msg.sender, block.number);
    }

    /// @notice Post a chat message. Must be checked in.
    /// @param message The message to post (max 280 bytes)
    function postMessage(string calldata message) external onlyCheckedIn {
        uint256 len = bytes(message).length;
        require(len > 0, "Empty message");
        require(len <= MAX_MESSAGE_LENGTH, "Message too long");

        _messages[messageWriteIndex] = ChatMessage({
            sender: msg.sender,
            message: message,
            blockNumber: block.number,
            timestamp: block.timestamp
        });

        messageWriteIndex = (messageWriteIndex + 1) % MAX_STORED_MESSAGES;
        totalMessages++;

        profiles[msg.sender].messageCount++;

        emit ChatMessagePosted(msg.sender, message, block.number);
    }

    /// @notice Record a social interaction with another agent. Both must be checked in.
    /// @param otherAgent The address of the agent to socialize with
    function socializeWith(address otherAgent) external onlyCheckedIn {
        require(otherAgent != msg.sender, "Cannot socialize with yourself");
        require(_isPresent(otherAgent), "Other agent not checked in");

        profiles[msg.sender].socializations++;
        profiles[otherAgent].socializations++;

        emit AgentSocialized(msg.sender, otherAgent);
    }

    // --- View Functions ---

    /// @notice Get addresses of agents currently checked in (within CHECK_IN_WINDOW)
    /// @return agents Array of present agent addresses
    function getPresentAgents() external view returns (address[] memory agents) {
        uint256 count = 0;
        uint256 len = _presentAgents.length;

        // First pass: count active agents
        for (uint256 i = 0; i < len; i++) {
            if (_isPresent(_presentAgents[i])) {
                count++;
            }
        }

        // Second pass: collect active agents
        agents = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < len; i++) {
            if (_isPresent(_presentAgents[i])) {
                agents[idx++] = _presentAgents[i];
            }
        }
    }

    /// @notice Get count of agents currently checked in
    /// @return count Number of present agents
    function getActiveAgentCount() external view returns (uint256 count) {
        uint256 len = _presentAgents.length;
        for (uint256 i = 0; i < len; i++) {
            if (_isPresent(_presentAgents[i])) {
                count++;
            }
        }
    }

    /// @notice Get recent chat messages
    /// @param count Number of messages to retrieve (capped at totalMessages and MAX_STORED_MESSAGES)
    /// @return messages Array of recent chat messages, newest first
    function getRecentMessages(uint256 count) external view returns (ChatMessage[] memory messages) {
        uint256 available = totalMessages < MAX_STORED_MESSAGES ? totalMessages : MAX_STORED_MESSAGES;
        if (count > available) count = available;
        if (count == 0) return messages;

        messages = new ChatMessage[](count);
        for (uint256 i = 0; i < count; i++) {
            // Walk backwards from the most recent write position
            uint256 idx = (messageWriteIndex + MAX_STORED_MESSAGES - 1 - i) % MAX_STORED_MESSAGES;
            messages[i] = _messages[idx];
        }
    }

    /// @notice Get an agent's social profile
    /// @param agent The agent address
    /// @return checkInCount Total check-ins
    /// @return lastCheckIn Block number of last check-in
    /// @return messageCount Total messages posted
    /// @return socializations Total social interactions
    function getAgentProfile(address agent) external view returns (
        uint256 checkInCount,
        uint256 lastCheckIn,
        uint256 messageCount,
        uint256 socializations
    ) {
        AgentProfile memory p = profiles[agent];
        checkInCount = p.checkInCount;
        lastCheckIn = p.lastCheckIn;
        messageCount = p.messageCount;
        socializations = p.socializations;
    }

    // --- Internal ---

    /// @dev Check if an agent is currently present (checked in within window)
    function _isPresent(address agent) internal view returns (bool) {
        uint256 lastCheckIn = profiles[agent].lastCheckIn;
        if (lastCheckIn == 0) return false;
        return block.number <= lastCheckIn + CHECK_IN_WINDOW;
    }

    /// @dev Find the index of an expired agent in _presentAgents, or type(uint256).max if none.
    function _findExpiredSlot() internal view returns (uint256) {
        uint256 len = _presentAgents.length;
        for (uint256 i = 0; i < len; i++) {
            if (!_isPresent(_presentAgents[i])) {
                return i;
            }
        }
        return type(uint256).max;
    }
}
