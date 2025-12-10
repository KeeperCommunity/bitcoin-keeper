import React from 'react';
import { ScrollView, VStack } from 'native-base';
import TicketItem from './TicketItem';
import { hp } from 'src/constants/responsive';
import { StyleSheet } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { useAppSelector } from 'src/store/hooks';
const TIP_FIELD_ID = 32435958308509;

const TicketList = () => {
  const { tickets } = useAppSelector((state) => state.concierge);
  const navigation = useNavigation();
  const handlePress = (ticketId, ticketStatus, isTipTicket) => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'TicketDetails',
        params: { ticketId, ticketStatus, isTipTicket },
      })
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <VStack style={styles.ticketContainer}>
        {tickets.map((ticket, index) => (
          <TicketItem
            key={index}
            ticket={ticket}
            handlePress={() => {
              const isTipTicket = ticket.custom_fields.find(
                (field) => field.id === TIP_FIELD_ID
              ).value;
              handlePress(ticket.id, ticket.status, isTipTicket);
            }}
          />
        ))}
      </VStack>
    </ScrollView>
  );
};

export default TicketList;

const styles = StyleSheet.create({
  container: {
    paddingBottom: hp(100),
  },
  ticketContainer: {
    marginTop: hp(5),
  },
});
