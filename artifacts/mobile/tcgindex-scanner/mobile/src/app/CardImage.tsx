import {Text} from './Localized';
import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle} from 'react-native';
import {imageUrl} from './api';

// Public thumbnails are trimmed and resized by the mobile API. Private member
// photos keep their original authenticated route.
export function CardImage({src, style, headers, accessibilityLabel}: {
  src?: string | null; id?: string; style: StyleProp<ImageStyle>; headers?: Record<string, string>; accessibilityLabel?: string;
}) {
  const [retry, setRetry] = useState(false), [failed, setFailed] = useState(false);
  const [box, setBox] = useState({width:0, height:0});
  const [source, setSource] = useState<{uri:string; width:number; height:number} | null>(null);
  useEffect(() => {setRetry(false); setFailed(false);}, [src]);
  const original = imageUrl(src);
  const publicImage = src && !headers && !src.startsWith('/api/mobile/v1/images/');
  const thumbnail = publicImage ? imageUrl('/api/mobile/v1/cards/image?v=2&src=' + encodeURIComponent(src)) : original;
  const uri = retry ? original : thumbnail;
  // Clip at the actual image bounds, not the larger contain box. This also
  // rounds white backgrounds in original/fallback images without cropping text.
  const scale = source && source.uri === uri && source.width > 0 && source.height > 0 && box.width > 0 && box.height > 0
    ? Math.min(box.width / source.width, box.height / source.height) : null;
  const fitted = scale != null && source ? {width:source.width * scale, height:source.height * scale} : {width:'100%' as const, height:'100%' as const};
  const radius = Math.min(10, (box.width || 100) * .1);
  return <View style={[style as StyleProp<ViewStyle>, styles.box, {borderRadius:radius}]}
    onLayout={({nativeEvent:{layout}}) => setBox(old => old.width === layout.width && old.height === layout.height ? old : {width:layout.width, height:layout.height})}>
    {!uri || failed ? <Text style={styles.placeholder}>이미지 준비 중</Text> :
      <View style={[fitted, {borderRadius:radius, overflow:'hidden'}]}>
        <Image key={uri} accessibilityLabel={accessibilityLabel} source={{uri, ...(headers ? {headers} : {})}} style={styles.image} resizeMode="contain"
          onLoad={({nativeEvent}) => setSource({uri, width:nativeEvent.source.width, height:nativeEvent.source.height})}
          onError={() => {if (!retry && thumbnail !== original && original) setRetry(true); else setFailed(true);}}/>
      </View>}
  </View>;
}
const styles = StyleSheet.create({box:{alignItems:'center', justifyContent:'center', overflow:'hidden', backgroundColor:'#202020'},image:{width:'100%', height:'100%'},placeholder:{fontSize:10, color:'#a6a6a6', textAlign:'center'}});
