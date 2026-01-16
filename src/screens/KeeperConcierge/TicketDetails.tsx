import { Box, ScrollView, useColorMode } from 'native-base';
import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';
import ConciergeHeader from './components/ConciergeHeader';
import ConciergeScreenWrapper from './components/ConciergeScreenWrapper';
import ContentWrapper from '../../components/ContentWrapper';
import { hp, wp } from 'src/constants/responsive';
import ReachOutArrowLight from 'src/assets/images/reach-out-arrow-light.svg';
import ReachOutArrowDark from 'src/assets/images/reach-out-arrow-dark.svg';

import Text from 'src/components/KeeperText';
import KeeperIconRound from 'src/assets/images/keeperIconRound.svg';
import { timeFromTimeStamp } from 'src/utils/utilities';
import { useDispatch } from 'react-redux';
import PaperPlaneLight from 'src/assets/images/paper-plane-light.svg';
import PaperPlaneDark from 'src/assets/images/paper-plane-black.svg';
import KeeperTextInput from 'src/components/KeeperTextInput';
import { updateTicketCommentsCount } from 'src/store/reducers/concierge';
import { useAppSelector } from 'src/store/hooks';
import Relay from 'src/services/backend/Relay';
import FastImage from 'react-native-fast-image';

const TicketNote = ({ note, closed = false }) => {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  return (
    <Box style={styles.noteContainer}>
      {isDarkMode ? <ReachOutArrowDark /> : <ReachOutArrowLight />}
      <Text color={closed ? `${colorMode}.greenWhiteText` : `${colorMode}.greenishGreyText`}>
        {note}
      </Text>
    </Box>
  );
};

const TicketDetails = ({ route }) => {
  const { ticketId, ticketStatus, isTipTicket } = route.params;
  const { conciergeUser } = useAppSelector((store) => store.concierge);
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const [comments, setComments] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showNote, setShowNote] = useState(true);
  const [newDesc, setNewDesc] = useState('');
  const flatListRef = useRef();
  const ticketClosed = ['Solved', 'solved'].includes(ticketStatus);
  const dispatch = useDispatch();
  const isiOS = Platform.OS === 'ios';
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height - (isiOS ? hp(32) : 0));
    });
    const keyboardDidHideListener = Keyboard.addListener('keyboardDidHide', (e) => {
      setKeyboardHeight(0);
    });

    return () => {
      keyboardDidHideListener.remove();
      keyboardDidShowListener.remove();
    };
  }, []);

  useEffect(() => {
    loadComments();
  }, []);

  useEffect(() => {
    setShowNote(comments?.[comments?.length - 1]?.author_id === conciergeUser.id);
  }, [comments]);

  const loadComments = async () => {
    setLoading(true);
    try {
      const res = await Relay.getZendeskTicketComments(ticketId);
      if (res.status === 200) {
        setComments(res.data.comments);
        // update comments count in state
        dispatch(updateTicketCommentsCount({ [ticketId]: res.data.comments.length }));
      }
    } catch (error) {
      console.log('🚀 ~ loadComments ~ error:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderComment = ({ item: comment }) => {
    return (
      <Box key={comment.id} style={styles.commentContainer}>
        {/* Profile Header */}
        <Box marginBottom={5} flexDirection={'row'} justifyContent={'space-between'}>
          <Box flexDirection={'row'}>
            <Box height={30} width={30} borderRadius={100}>
              <KeeperIconRound />
            </Box>
            <Box marginLeft={2.5}>
              <Text color={`${colorMode}.primaryText`} medium fontSize={14}>
                {conciergeUser.id == comment.author_id ? 'Visitor' : 'Keeper Tech Team'}
              </Text>
              <Text color={`${colorMode}.primaryText`} light fontSize={11}>
                {`Reference ID #${ticketId}`}
              </Text>
            </Box>
          </Box>
          <Box>
            <Text color={`${colorMode}.primaryText`} fontSize={11} light>
              {timeFromTimeStamp(comment.created_at)}
            </Text>
          </Box>
        </Box>

        <Text color={`${colorMode}.primaryText`} fontSize={13}>
          {comment.body}
        </Text>
        <ScrollView
          horizontal
          contentContainerStyle={styles.imageContainer}
          showsHorizontalScrollIndicator={false}
        >
          {comment.attachments &&
            comment.attachments.map((item) => {
              return (
                <Box height={20} width={20}>
                  <FastImage
                    source={{ uri: item.content_url }}
                    style={{ flex: 1, height: '100%' }}
                  />
                </Box>
              );
            })}
        </ScrollView>
      </Box>
    );
  };

  const addNewComment = async () => {
    if (!newDesc) return; 
    setLoading(true);
    try {
      const res = await Relay.addZendeskComment(ticketId, conciergeUser.id, newDesc);
      if (res.status === 200) {
        await loadComments();
        setNewDesc('');
        setTimeout(() => {
          // @ts-ignore
          flatListRef.current.scrollToEnd();
        }, 100);
      }
    } catch (error) {
      console.log('🚀 ~ addNewComment ~ error:', error);
    } finally {
      setLoading(false);
    }
  };

  const ListFooterComponent = () => (
    <Box style={styles.note}>
      {(showNote && !ticketClosed) || ticketClosed ? (
        <TicketNote
          closed={ticketClosed}
          note={
            isTipTicket == 'true'
              ? 'The team has received your message and is thankful for your tip.'
              : ticketClosed
              ? 'Issue resolved. Thank you for contacting our tech team. Your feedback is valued.'
              : 'Hi! Acknowledging your message. Someone from the team will get back to you shortly.'
          }
        />
      ) : null}
    </Box>
  );

  const Separator = () => <Box height={0.5} backgroundColor={`${colorMode}.separator`} />;

  return (
    <ConciergeScreenWrapper
      backgroundcolor={`${colorMode}.pantoneGreen`}
      barStyle="light-content"
      loading={loading}
    >
      <ConciergeHeader title={'Support Team'} />
      <ContentWrapper backgroundColor={`${colorMode}.primaryBackground`}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Box style={styles.contentContainer}>
            <Box>
              <FlatList
                ref={flatListRef}
                data={comments}
                keyExtractor={(item) => item.id}
                renderItem={renderComment}
                ItemSeparatorComponent={Separator}
                ListFooterComponent={ListFooterComponent}
              />
            </Box>
          </Box>
          {!ticketClosed && (
            <Box
              style={[
                styles.inputContainer,
                isiOS && {
                  paddingBottom: keyboardHeight,
                },
              ]}
            >
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
                  <KeeperTextInput
                    placeholder={'Write your Query...'}
                    onChangeText={setNewDesc}
                    value={newDesc}
                    inpuBackgroundColor={`${colorMode}.primaryBackground`}
                    InputRightComponent={
                      <Pressable style={[styles.touchable]} onPress={addNewComment}>
                        {isDarkMode ? <PaperPlaneLight /> : <PaperPlaneDark />}
                      </Pressable>
                    }
                  />
                </TouchableWithoutFeedback>
              </KeyboardAvoidingView>
            </Box>
          )}
        </ScrollView>
      </ContentWrapper>
    </ConciergeScreenWrapper>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    flex: 1,
  },
  commentContainer: {
    paddingHorizontal: wp(25),
    paddingVertical: hp(25),
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  note: {
    paddingHorizontal: wp(25),
    paddingVertical: hp(25),
  },
  noteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(10),
    width: '90%',
  },
  inputContainer: {
    marginHorizontal: wp(16),
  },
  touchable: {
    justifyContent: 'center',
    margin: 6,
  },
  closed: {
    paddingHorizontal: wp(25),
    paddingVertical: hp(25),
  },
  imageContainer: {
    gap: wp(20),
  },
});

export default TicketDetails;
