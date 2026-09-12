import React from "react";
import { Tabs,Redirect } from "expo-router";
import { useAuth } from "@clerk/expo";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePwaBottomInset } from "@/hooks/usePwaBottomInset";
import { useUnreadMessageCount } from "@/hooks/useUnreadMessageCount";
import { C,Icon } from "@/components/davaq/UI";
export default function TabLayout(){
 const {isLoaded,isSignedIn}=useAuth(),insets=useSafeAreaInsets(),pwa=usePwaBottomInset(),{count}=useUnreadMessageCount(),bottom=Platform.OS==="web"?pwa:insets.bottom;
 if(!isLoaded)return null;if(!isSignedIn)return <Redirect href="/(auth)/sign-in"/>;
 const tab=(title:string,name:string)=>({title,tabBarIcon:({color}:{color:string})=><Icon name={name} color={color} size={23}/>});
 return <Tabs screenOptions={{headerShown:false,sceneStyle:{backgroundColor:C.bg},tabBarActiveTintColor:C.purple,tabBarInactiveTintColor:C.muted,tabBarLabelStyle:{fontSize:11,lineHeight:16,flexShrink:0,fontWeight:"600",marginTop:2},tabBarItemStyle:{paddingVertical:0},tabBarStyle:{position:"absolute",height:72+bottom,paddingTop:10,paddingBottom:Math.max(10,bottom),backgroundColor:"white",borderTopColor:C.line,elevation:0}}}>
 <Tabs.Screen name="index" options={tab("홈","home")}/><Tabs.Screen name="search" options={tab("둘러보기","search")}/><Tabs.Screen name="chats" options={{...tab("채팅","message-circle"),tabBarBadge:count>0?(count>99?"99+":count):undefined,tabBarBadgeStyle:{backgroundColor:C.purple,color:"white"}}}/><Tabs.Screen name="agent" options={tab("내 AI","cpu")}/><Tabs.Screen name="exchanges" options={tab("내 교환","repeat")}/>
 {["feed","battle","dungeon","quests","persona","character/[profileId]"].map(name=><Tabs.Screen key={name} name={name} options={{href:null}}/>)}
 </Tabs>;
}
