import React from 'react';
import {View} from 'react-native';
import {SafeAreaInsetsContext,useSafeAreaInsets} from 'react-native-safe-area-context';
// The in-flow call banner already consumes the top safe area. Do not pad the
// navigator a second time, or cover its header/back button with an overlay.
export function CallContentFrame({banner,children}:{banner?:React.ReactNode;children:React.ReactNode}){
 const insets=useSafeAreaInsets();return <View style={{flex:1}}>{banner}<View style={{flex:1}}><SafeAreaInsetsContext.Provider value={banner?{...insets,top:0}:insets}>{children}</SafeAreaInsetsContext.Provider></View></View>;
}
