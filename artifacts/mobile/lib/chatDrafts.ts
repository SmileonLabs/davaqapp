import AsyncStorage from "@react-native-async-storage/async-storage";
import { createChatDraftStore } from "./chatDraftPolicy";
export const chatDrafts = createChatDraftStore(AsyncStorage);
