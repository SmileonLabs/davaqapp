package com.margelo.nitro.tcgscanner

import org.json.JSONArray
import org.json.JSONObject

/** Image retrieval confirms artwork; OCR must disambiguate an exact printing. */
object CompactIdentity {
  private fun letters(s:String)=java.text.Normalizer.normalize(s,java.text.Normalizer.Form.NFKC).uppercase().replace(Regex("[^\\p{L}\\p{N}]"),"")
  // A double-faced card prints one face's title, not the catalog's A // B name.
  private fun titles(card:JSONObject)=card.optString("name").split(" // ").filter{letters(it).length>=if(Regex("[가-힣ぁ-ヿ一-鿿]").containsMatchIn(it))2 else 3}
  fun titleSeen(card:JSONObject,text:String)=titles(card).any{title->
    if(Regex("[가-힣ぁ-ヿ一-鿿]").containsMatchIn(title))letters(text).contains(letters(title))
    else Regex("(?<![A-Z0-9])"+Regex.escape(title.uppercase())+"(?![A-Z0-9])").containsMatchIn(java.text.Normalizer.normalize(text,java.text.Normalizer.Form.NFKC).uppercase())
  }
  fun lookupHints(text:String):List<String> {
    val normalized=java.text.Normalizer.normalize(text,java.text.Normalizer.Form.NFKC)
    val names=normalized.lineSequence().take(8).map{it.trim().replace(Regex("^\\d+\\s*|\\s*\\d+$"),"")}
      .filter{it.length in 2..60&&it.count{c->c.isLetter()}>=if(Regex("[가-힣ぁ-ヿ一-鿿]").containsMatchIn(it))2 else 3}.toList()
    val codes=Regex("(?:(?:OP|ST|EB|PRB|FB|FS|SB)\\d{2}|FP|P)-\\d{2,3}",RegexOption.IGNORE_CASE).findAll(normalized.replace(Regex("\\s+"),"")).map{it.value}.toList()
    // Name candidates remain available even when OCR reads a different number.
    return (names+codes).distinct().take(10)
  }
  fun textMatches(card:JSONObject,text:String):Boolean {
    if(titleSeen(card,text))return true
    val code=Regex("(?:(?:OP|ST|EB|PRB|FB|FS|SB)\\d{2}|FP)-\\d{2,3}").find(card.optString("number").uppercase())?.value
    return code!=null&&text.uppercase().replace(Regex("\\s+"),"").contains(code)
  }
  private fun number(value:String,game:String=""):String {
    val s=java.text.Normalizer.normalize(value,java.text.Normalizer.Form.NFKC).uppercase().replace(Regex("\\s+"),"")
    if(game=="magic"&&s.matches(Regex("#?\\d{1,4}[A-Z]?")))return s.removePrefix("#").replace(Regex("^0+(?=\\d)"),"")
    Regex("((?:SV|SM|XY|BW|DP|S|M)\\d{1,2}[A-Z]{0,2}(?:-P)?)-?(\\d{1,3})[/⁄-](\\d{1,3})(?!\\d)").find(s)?.let{return "${it.groupValues[1]}-${it.groupValues[2].toInt()}/${it.groupValues[3].toInt()}"}
    Regex("(OGN|SFD|OGS|VEN|UNL)-(\\d{3})([A-Z]?)[/⁄-](\\d{3})(-F)?").find(s)?.let{return "${it.groupValues[1]}-${it.groupValues[2]}${it.groupValues[3]}/${it.groupValues[4]}${it.groupValues[5]}"}
    Regex("(?:PROMO)?(\\d{1,4})[/⁄-](SV-P|SM-P|XY-P|BW-P|DP-P|L-P|ADV-P|PCG-P|S-P)").find(s)?.let{return "PROMO${it.groupValues[1]}-${it.groupValues[2]}"}
    Regex("(?:SWSH|HGSS|SM|XY|BW|DP)-?\\d{1,4}(?![A-Z0-9/-])").find(s)?.let{return it.value.replace("-","")}
    Regex("(?:(?:OP|ST|EB|PRB|FB|FS|SB)\\d{2}|FP|P)-\\d{2,3}").find(s)?.let{return it.value}
    Regex("(?:RD/)?[A-Z0-9]{2,10}-(?:KR|JP|EN|AE|DE|FR|IT|SP|PT|K|E|J|S)(?:\\d{3}|S\\d{2})").find(s)?.let{return it.value}
    Regex("(?=(?<!\\d)(\\d{1,3})[/⁄-](\\d{1,3})(?!\\d))").findAll(s).lastOrNull()?.let{return "${it.groupValues[1].toInt()}/${it.groupValues[2].toInt()}"}
    if(s.matches(Regex("#?\\d{1,4}")))return s.removePrefix("#").toInt().toString()
    return ""
  }
  /** Unknown-card suggestions still require printed card content and geometry;
   * generic screens, keyboards and plain rectangles must not produce guesses. */
  fun cardText(text:String):Boolean {
    val s=java.text.Normalizer.normalize(text,java.text.Normalizer.Form.NFKC).uppercase()
    if(s.length<12)return false
    val tokens=listOf("CREATURE","INSTANT","SORCERY","ENCHANTMENT","ARTIFACT","PLANESWALKER","TRAINER","POKÉMON","POKEMON","HP","CHARACTER","COUNTER","STAGE","DON!!","BATTLE","LEADER","COMBO","ATK","DEF","SPELL","TRAP","포켓몬","트레이너","캐릭터","몬스터","마법","함정","トレーナー","ポケモン","たね".uppercase(),"カウンター","バトル","リーダー")
    val count=tokens.count{if(it.matches(Regex("[A-Z]+")))Regex("\\b"+it+"\\b").containsMatchIn(s)else s.contains(it)}
    val collector=Regex("(?:\\d{1,3}\\s*[/⁄]\\s*\\d{1,3}|(?:(?:OP|ST|EB|PRB|FB|FS|SB)\\d{2}|FP)-\\d{2,3}|[A-Z0-9]{2,10}-(?:EN|JP|KR)\\d{3}|(?<!\\d)\\d{8}(?!\\d))").containsMatchIn(s)
    return count>=1&&collector
  }
  fun exact(candidates:List<CompactCardIndex.Candidate>,text:String,language:String):CompactCardIndex.Candidate? {
    if(text.isBlank())return null
    val compact=java.text.Normalizer.normalize(text,java.text.Normalizer.Form.NFKC).uppercase().replace(Regex("\\s+"),"")
    val detected=if(language!="all")language else if(Regex("[가-힣]").containsMatchIn(text))"ko" else if(Regex("[ぁ-ヿ]").containsMatchIn(text))"ja" else ""
    val namedCandidates=candidates.filter{titleSeen(it.card,text)}
    val matches=candidates.filter {
      val n=number(it.card.optString("number"),it.card.optString("game"))
      if(n.isEmpty() || it.card.optString("matchLevel")=="card" || it.id.startsWith("photo:"))false
      else {
        val set=it.card.optString("setCode").uppercase()
        val unnamed=titles(it.card).isEmpty() && set.length in 2..8 &&
          Regex("(?<![A-Z0-9])"+Regex.escape(set)+"(?![A-Z0-9])").containsMatchIn(text.uppercase()) &&
          Regex("\\b(CREATURE|ENCHANTMENT|SORCERY|ARTIFACT|INSTANT|LAND)\\b").containsMatchIn(text.uppercase())
        val named=titleSeen(it.card,text)||unnamed
        val lang=if(detected.isNotEmpty())detected else if(it.card.optString("language")=="en" && named)"en" else ""
        // Magic's small footer often reads 0196 as O196. Repair only a leading
        // zero, with both the card title and printed set code as evidence;
        // never replace letters throughout the OCR text or another game's ID.
        val magicFooter=it.card.optString("game")=="magic" && set.length in 2..8 &&
          Regex("(?<![A-Z0-9])"+Regex.escape(set)+"(?![A-Z0-9])").containsMatchIn(text.uppercase())
        val zeros=if(magicFooter)"[0O]*" else "0*"
        val seen=Regex("(?=(?<!\\d)(\\d{1,3})\\s*[/⁄-]\\s*(\\d{1,3})(?!\\d))").findAll(text.uppercase()).map { m->"${m.groupValues[1].toInt()}/${m.groupValues[2].toInt()}" }.toSet()
        val pokemon=Regex("^((?:SV|SM|XY|BW|DP|S|M)\\d{1,2}[A-Z]{0,2}(?:-P)?)-(\\d{1,3})/(\\d{1,3})$").matchEntire(n)
        val coded=number(compact,it.card.optString("game"))
        val printedPokemonSets=Regex("(?<![A-Z0-9])(?:SV|SM|XY|BW|DP|S|M)\\d{1,2}[A-Z]{0,2}(?:-P)?(?![A-Z0-9])").findAll(text.uppercase()).map{it.value}.toSet()
        val pokemonSeen=pokemon!=null && "${pokemon.groupValues[2].toInt()}/${pokemon.groupValues[3].toInt()}" in seen &&
          (printedPokemonSets.isEmpty()||pokemon.groupValues[1] in printedPokemonSets)
        val collector=n==coded || pokemonSeen || n in seen || n.contains('-')&&compact.contains(n) ||
          n.matches(Regex("\\d{1,4}[A-Z]?"))&&named&&
          Regex("(?<![A-Z0-9])"+zeros+Regex.escape(n)+"(?![A-Z0-9])").containsMatchIn(java.text.Normalizer.normalize(text,java.text.Normalizer.Form.NFKC).uppercase())
        val nameAgrees=namedCandidates.isEmpty()||namedCandidates.any{named->number(named.card.optString("number"),named.card.optString("game"))==n}
        lang==it.card.optString("language") && collector && nameAgrees
      }
    }
    // Duplicate provider listings may describe the same printing. Different
    // sets/finishes/languages remain unresolved even when their art is identical.
    val printedSets=matches.filter {candidate->
      val code=candidate.card.optString("setCode").uppercase()
      code.length in 2..8&&Regex("(?<![A-Z0-9])"+Regex.escape(code)+"(?![A-Z0-9])").containsMatchIn(text.uppercase())
    }
    val editions=printedSets.ifEmpty{matches}
    val groups=editions.groupBy { listOf(it.card.optString("language"),number(it.card.optString("number"),it.card.optString("game")),it.card.optString("setCode").uppercase(),it.card.optString("rarity"),it.card.optString("finish")) }
    return if(groups.size==1)editions.maxByOrNull { it.similarity } else null
  }

  fun reference(candidate:CompactCardIndex.Candidate,alternatives:List<CompactCardIndex.Candidate> = emptyList()):JSONObject {
    val card=JSONObject(candidate.card.toString())
    val valuations=JSONArray((card.optJSONArray("valuations")?:JSONArray()).toString())
    // Only spatially verified editions may supply another-printing prices.
    // A nearest neighbour's price must never become an estimate by itself.
    for(source in (listOf(candidate)+alternatives).distinctBy {it.id}) {
      val prices=JSONArray((source.card.optJSONArray("prices")?:JSONArray()).toString())
      source.card.optJSONObject("price")?.let {prices.put(it)}
      var supplied=false
      for(i in 0 until prices.length()) {
        val price=prices.optJSONObject(i)?:continue;val amount=price.optDouble("amount");val currency=price.optString("currency")
        if(!amount.isFinite() || amount<=0 || currency !in listOf("KRW","USD","EUR"))continue
        valuations.put(JSONObject().put("amount",amount).put("low",amount).put("high",amount).put("currency",currency)
          .put("observedAt",price.optString("observedAt")).put("source",price.optString("source")).put("count",1).put("method","catalog_reference")
          .put("referenceKind","other_printing").put("sourceLanguage",source.card.optString("language")).put("sourceNumber",source.card.optString("number")))
        supplied=true
      }
      if(supplied&&!card.has("referenceThumbnail"))card.put("referenceThumbnail",JSONObject().put("image",source.card.optString("image")).put("href",source.card.optString("href")).put("name",source.card.optString("name")))
    }
    card.put("price",JSONObject.NULL).put("prices",JSONArray()).put("valuations",valuations).put("matchLevel","card").put("artworkSpecific",false)
    if(!candidate.id.startsWith("photo:")&&!card.has("referenceThumbnail"))card.put("referenceThumbnail",JSONObject().put("image",card.optString("image")).put("href",card.optString("href")).put("name",card.optString("name")))
    return card
  }
}
