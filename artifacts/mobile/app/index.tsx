import { useAuth } from "@clerk/expo";
import { Redirect } from "expo-router";
import { ActivityIndicator,View } from "react-native";
import { C,Cue,Txt } from "@/components/davaq/UI";
export default function Index(){const {isLoaded,isSignedIn}=useAuth();if(!isLoaded)return <View style={{flex:1,alignItems:"center",justifyContent:"center",gap:20,backgroundColor:C.bg}}><Cue size={150}/><Txt bold size={24}>새로운 경험을 만나는 중</Txt><ActivityIndicator color={C.purple}/></View>;return <Redirect href={isSignedIn?"/(tabs)":"/(auth)/sign-in"}/>;}
