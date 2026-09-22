import { Router, type IRouter } from "express";
import usersRouter from "./users";
import friendsRouter from "./friends";
import roomsRouter from "./rooms";
import messagesRouter from "./messages";
import invitesRouter from "./invites";
import blockedRouter from "./blocked";
import callsRouter from "./calls";
import storageRouter from "./storage";
import dungeonsRouter from "./dungeons";
import lifeQuestsRouter from "./lifeQuests";
import battlesRouter from "./battles";
import personaRouter from "./persona";
import clansRouter from "./clans";
import clanWarsRouter from "./clanWars";
import questsRouter from "./quests";
import playModeRouter from "./playMode";
import starFeedRouter from "./starFeed";
import walletsRouter from "./wallets";
import torimiaRouter from "./torimia";
import presenceRouter from "./presence";
import dailyTalkRewardRouter from "./dailyTalkReward";
import pvtRouter from "./pvt";
import anotherMeRouter from "./anotherMe";
import officialAccountsRouter from "./officialAccounts";
import knowledgeRouter from "./knowledge";
import realtimeRouter from "./realtime";
import fanCommunitiesRouter from "./fanCommunities";
import fanCommunityProgramsRouter from "./fanCommunityPrograms";
import starFeedAdminRouter from "./starFeedAdmin";
import searchAdminRouter from "./searchAdmin";
import nftCollectionsRouter from "./nftCollections";
import adminMembersRouter from "./adminMembers";
import adminAuditRouter from "./adminAudit";
import adminRolesRouter from "./adminRoles";
import adminOperationsRouter from "./adminOperations";
import characterProfilesRouter from "./characterProfiles";

import exchangeRouter from "./exchange";
import relayRouter from "./relay";
import agentsRouter from "./agents";
import agentConversationRouter from "./agentConversation";
import brandExchangeRouter from "./brandExchange";

const router: IRouter = Router();
router.use(exchangeRouter);
router.use(relayRouter);
router.use(agentsRouter);
router.use(agentConversationRouter);
router.use(brandExchangeRouter);

router.use(usersRouter);
router.use(friendsRouter);
router.use(roomsRouter);
router.use(messagesRouter);
router.use(invitesRouter);
router.use(blockedRouter);
router.use(callsRouter);
router.use(storageRouter);
// DavaQ: dungeons is outside the exchange service.
// DavaQ: lifeQuests is outside the exchange service.
// DavaQ: battles is outside the exchange service.
router.use(personaRouter);
// DavaQ: clans is outside the exchange service.
// DavaQ: clanWars is outside the exchange service.
// DavaQ: quests is outside the exchange service.
// DavaQ: playMode is outside the exchange service.
router.use(starFeedRouter);
// DavaQ: wallets is outside the exchange service.
// DavaQ: torimia is outside the exchange service.
router.use(presenceRouter);
// DavaQ: dailyTalkReward is outside the exchange service.
// DavaQ: pvt is outside the exchange service.
router.use(anotherMeRouter);
router.use(officialAccountsRouter);
router.use(knowledgeRouter);
router.use(realtimeRouter);
// DavaQ: fanCommunities is outside the exchange service.
// DavaQ: fanCommunityPrograms is outside the exchange service.
router.use(starFeedAdminRouter);
router.use(searchAdminRouter);
// DavaQ: nftCollections is outside the exchange service.
router.use(adminMembersRouter);
router.use(adminAuditRouter);
router.use(adminRolesRouter);
router.use(adminOperationsRouter);
router.use(characterProfilesRouter);

export default router;
